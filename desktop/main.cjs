const { app, BrowserWindow, dialog, ipcMain, shell, nativeTheme, safeStorage, session } = require("electron");
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { AcpAgentRun } = require("./acp-agent.cjs");
const {
  discoverModels,
  makeProviderId,
  makeEnvKey,
  makeLocalModelId,
  mergeManagedConfig
} = require("./provider-config.cjs");
const {
  readNativeConfig,
  saveRawConfig,
  updateNativeSetting
} = require("./native-config.cjs");
const { readAccountInfo } = require("./account-info.cjs");
const { createGitBranch, readGitInfo, switchGitBranch } = require("./git-workspace.cjs");

const activeRuns = new Map();
const acpRuns = new Map();
const runClients = new Map();
const terminalSessions = new Map();
const sessionUpdateBridges = new Map();
let mainWindow;
let activeAuthRun = null;
let activeAuthUrl = null;
let cachedSystemProxyEnvironment = {};

function localNoProxy(existing = "") {
  return [...new Set([...String(existing || "").split(",").map((item) => item.trim()).filter(Boolean), "localhost", "127.0.0.1", "::1", "[::1]"])].join(",");
}

async function refreshSystemProxyEnvironment(targetUrl) {
  try {
    const rule = await session.defaultSession.resolveProxy(targetUrl);
    const entries = String(rule || "").split(";").map((item) => item.trim()).filter(Boolean);
    const entry = entries.find((item) => /^(PROXY|HTTPS|SOCKS5?|SOCKS)\s+/i.test(item));
    if (entry) {
      const kind = entry.match(/^(PROXY|HTTPS|SOCKS5?|SOCKS)/i)?.[1]?.toUpperCase();
      const address = entry.replace(/^(PROXY|HTTPS|SOCKS5?|SOCKS)\s+/i, "");
      const proxyUrl = `${kind?.startsWith("SOCKS") ? "socks5" : "http"}://${address}`;
      const noProxy = localNoProxy(process.env.NO_PROXY || process.env.no_proxy);
      cachedSystemProxyEnvironment = {
        ...(kind?.startsWith("SOCKS")
          ? { ALL_PROXY: proxyUrl, all_proxy: proxyUrl }
          : { HTTPS_PROXY: proxyUrl, HTTP_PROXY: proxyUrl, https_proxy: proxyUrl, http_proxy: proxyUrl }),
        NO_PROXY: noProxy, no_proxy: noProxy
      };
    } else cachedSystemProxyEnvironment = { NO_PROXY: localNoProxy(process.env.NO_PROXY || process.env.no_proxy), no_proxy: localNoProxy(process.env.NO_PROXY || process.env.no_proxy) };
  } catch {}
  return cachedSystemProxyEnvironment;
}

async function environmentWithSystemProxy(baseEnv, targetUrl) {
  const hasExplicitProxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.ALL_PROXY || process.env.all_proxy;
  if (!hasExplicitProxy) await refreshSystemProxyEnvironment(targetUrl);
  return {
    ...baseEnv,
    ...(!hasExplicitProxy ? cachedSystemProxyEnvironment : {}),
    NO_PROXY: localNoProxy(baseEnv.NO_PROXY || baseEnv.no_proxy),
    no_proxy: localNoProxy(baseEnv.no_proxy || baseEnv.NO_PROXY)
  };
}

function providerStorePath() {
  return process.env.GROK_DESKTOP_PROVIDER_STORE
    ? path.resolve(process.env.GROK_DESKTOP_PROVIDER_STORE)
    : path.join(app.getPath("userData"), "providers.json");
}

function grokConfigPath() {
  return process.env.GROK_DESKTOP_CONFIG_HOME
    ? path.join(process.env.GROK_DESKTOP_CONFIG_HOME, "config.toml")
    : path.join(app.getPath("home"), ".grok", "config.toml");
}

function grokHomePath() {
  return process.env.GROK_DESKTOP_CONFIG_HOME || path.join(app.getPath("home"), ".grok");
}

function authFilePath() {
  return path.join(grokHomePath(), "auth.json");
}

function authInfo() {
  return readAccountInfo(authFilePath(), process.env);
}

function integrationSummary(raw) {
  const sectionNames = [...String(raw || "").matchAll(/^\s*\[([^\]]+)\]/gm)].map((match) => match[1]);
  const listSections = (prefix) => [...new Set(sectionNames.filter((name) => name.startsWith(prefix)).map((name) => name.split(".").slice(0, 2).join(".")))];
  const listDirectory = (name) => {
    const target = path.join(grokHomePath(), name);
    try {
      return {
        path: target,
        items: fs.readdirSync(target, { withFileTypes: true }).filter((entry) => !entry.name.startsWith(".")).map((entry) => entry.name).sort((a, b) => a.localeCompare(b))
      };
    } catch {
      return { path: target, items: [] };
    }
  };
  const mcp = listSections("mcp_servers.");
  const models = listSections("model.");
  const plugins = listDirectory("plugins");
  const skills = listDirectory("skills");
  const hooks = listDirectory("hooks");
  const agents = listDirectory("agents");
  return {
    mcp: { count: mcp.length, items: mcp, source: "config.toml", path: grokConfigPath() },
    models: { count: models.length, items: models, source: "config.toml", path: grokConfigPath() },
    plugins: { count: plugins.items.length, items: plugins.items, source: "plugins/", path: plugins.path },
    skills: { count: skills.items.length, items: skills.items, source: "skills/", path: skills.path },
    hooks: { count: hooks.items.length, items: hooks.items, source: "hooks/", path: hooks.path },
    agents: { count: agents.items.length, items: agents.items, source: "agents/", path: agents.path }
  };
}

function loadProviderStore() {
  try {
    const value = JSON.parse(fs.readFileSync(providerStorePath(), "utf8"));
    return { providers: Array.isArray(value.providers) ? value.providers : [] };
  } catch {
    return { providers: [] };
  }
}

function encryptApiKey(value) {
  const key = String(value || "");
  if (safeStorage.isEncryptionAvailable()) {
    return { encoding: "safe-storage", value: safeStorage.encryptString(key).toString("base64") };
  }
  return { encoding: "base64", value: Buffer.from(key, "utf8").toString("base64") };
}

function decryptApiKey(secret) {
  if (!secret?.value) return "";
  try {
    const data = Buffer.from(secret.value, "base64");
    return secret.encoding === "safe-storage" ? safeStorage.decryptString(data) : data.toString("utf8");
  } catch {
    return "";
  }
}

function providerEnvironment() {
  return Object.fromEntries(loadProviderStore().providers.map((provider) => [provider.envKey, decryptApiKey(provider.secret)]).filter(([, key]) => key));
}

function runtimeEnvironment(extra = {}) {
  const env = { ...cachedSystemProxyEnvironment, ...process.env, ...providerEnvironment(), ...extra };
  env.NO_PROXY = localNoProxy(env.NO_PROXY || env.no_proxy); env.no_proxy = env.NO_PROXY;
  return env;
}

function runtimeTargetUrl(modelId) {
  if (modelId && modelId !== "auto") {
    const provider = loadProviderStore().providers.find((item) => (item.models || []).some((model) => model.localId === modelId));
    if (provider?.baseUrl) return provider.baseUrl;
  }
  return "https://auth.x.ai/.well-known/openid-configuration";
}

function publicProviders(store = loadProviderStore()) {
  return store.providers.map(({ secret, ...provider }) => ({
    ...provider,
    hasKey: Boolean(secret?.value),
    keyProtected: secret?.encoding === "safe-storage"
  }));
}

function persistProviderStore(store) {
  fs.mkdirSync(path.dirname(providerStorePath()), { recursive: true });
  fs.writeFileSync(providerStorePath(), `${JSON.stringify(store, null, 2)}\n`, "utf8");
  const configPath = grokConfigPath();
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const existing = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : "";
  fs.writeFileSync(configPath, mergeManagedConfig(existing, store.providers), "utf8");
}

function locateGrok() {
  const candidates = [
    process.env.GROK_BINARY,
    app.isPackaged && path.join(process.resourcesPath, "bin", process.platform === "win32" ? "grok.exe" : "grok"),
    path.join(__dirname, "..", "target", "release", process.platform === "win32" ? "xai-grok-pager.exe" : "xai-grok-pager"),
    path.join(__dirname, "..", "target", "debug", process.platform === "win32" ? "xai-grok-pager.exe" : "xai-grok-pager"),
    process.platform === "win32" && process.env.USERPROFILE
      ? path.join(process.env.USERPROFILE, ".grok", "bin", "grok.exe")
      : process.env.HOME && path.join(process.env.HOME, ".grok", "bin", "grok")
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {}
  }

  const probe = spawnSync(process.platform === "win32" ? "where.exe" : "which", ["grok"], {
    encoding: "utf8",
    windowsHide: true
  });
  if (probe.status === 0) {
    const first = probe.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
    if (first) return first;
  }
  return null;
}

function runCommand(command, args, { timeout = 10_000, env = process.env } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { windowsHide: true, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish({ status: null, stdout, stderr, timedOut: true });
    }, timeout);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => finish({ status: null, stdout, stderr, error: error.message }));
    child.on("close", (code) => finish({ status: code, stdout, stderr }));
  });
}

function parseModelList(output) {
  const text = String(output || "");
  return {
    defaultModel: text.match(/Default model:\s*([^\s]+)/i)?.[1] || null,
    models: [...new Set([...text.matchAll(/^\s*(?:\*|-)\s+([^\s(]+)/gm)].map((match) => match[1]))]
  };
}

function runtimeBase(binary) {
  return {
    connected: Boolean(binary),
    binary,
    version: null,
    models: [],
    defaultModel: null,
    modelsReady: false,
    platform: process.platform,
    packaged: app.isPackaged,
    defaultCwd: app.isPackaged ? app.getPath("documents") : path.resolve(__dirname, "..")
  };
}

async function runtimeInfo() {
  const binary = locateGrok();
  const info = runtimeBase(binary);
  if (!binary) {
    info.modelsReady = true;
    return info;
  }
  const result = await runCommand(binary, ["--version"], { timeout: 5000, env: runtimeEnvironment() });
  info.version = (result.stdout || result.stderr || "").trim() || null;
  return info;
}

async function runtimeModels() {
  const binary = locateGrok();
  if (!binary) return { ok: false, binary: null, models: [], defaultModel: null, modelsReady: true };
  await refreshSystemProxyEnvironment(runtimeTargetUrl());
  const modelResult = await runCommand(binary, ["models"], { timeout: 10_000, env: runtimeEnvironment() });
  const parsed = parseModelList(`${modelResult.stdout || ""}\n${modelResult.stderr || ""}`);
  return { ok: true, binary, ...parsed, modelsReady: true };
}

function emit(data) {
  const clientId = data?.runId ? runClients.get(data.runId) : null;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("grok:event", clientId ? { clientId, ...data } : data);
}

function parseLines(runId, stream, source) {
  let buffer = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) dispatchLine(runId, line, source);
  });
  stream.on("end", () => {
    if (buffer.trim()) dispatchLine(runId, buffer, source);
  });
}

function dispatchLine(runId, line, source) {
  const value = line.trim();
  if (!value) return;
  if (source === "stderr") {
    emit({ runId, type: "diagnostic", data: value.replace(/\x1b\[[0-9;]*m/g, "") });
    return;
  }
  try {
    const event = JSON.parse(value);
    if (event?.type === "end") sessionUpdateBridges.get(runId)?.flush();
    emit({ runId, ...event });
  } catch {
    emit({ runId, type: "text", data: line });
  }
}

function effectivePrompt(payload) {
  let prompt = String(payload.prompt || "");
  if (Array.isArray(payload.attachments) && payload.attachments.length) {
    const attachmentNote = payload.attachments.map((file) => `- ${file}`).join("\n");
    prompt += `\n\nAttached local files:\n${attachmentNote}`;
  }
  return prompt;
}

function buildArgs(payload) {
  const args = ["--cwd", payload.cwd, "-p", effectivePrompt(payload), "--output-format", "streaming-json"];
  if (payload.sessionId) args.push("--resume", payload.sessionId);
  if (payload.model && payload.model !== "auto") args.push("--model", payload.model);
  if (payload.effort && payload.effort !== "auto") args.push("--reasoning-effort", payload.effort);
  if (payload.alwaysApprove) args.push("--always-approve");
  return args;
}

function sessionsRootForWorkspace(cwd) {
  return path.join(grokHomePath(), "sessions", encodeURIComponent(path.resolve(cwd)));
}

function sessionFiles(root) {
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({
        sessionId: entry.name,
        updates: path.join(root, entry.name, "updates.jsonl"),
        events: path.join(root, entry.name, "events.jsonl")
      }));
  } catch { return []; }
}

function fileSizes(root) {
  const sizes = new Map();
  for (const files of sessionFiles(root)) {
    for (const file of [files.updates, files.events]) {
      try { sizes.set(file, fs.statSync(file).size); } catch {}
    }
  }
  return sizes;
}

function toolContentText(content) {
  if (!Array.isArray(content)) return "";
  return content.map((item) => item?.content?.text || item?.text || item?.content?.content?.text || "").filter(Boolean).join("\n");
}

function cappedValue(value, max = 24_000) {
  if (value == null) return null;
  try {
    const raw = JSON.stringify(value);
    return raw.length <= max ? value : { truncated: true, preview: raw.slice(0, max) };
  } catch { return String(value).slice(0, max); }
}

function relaySessionUpdate(runId, update, meta = {}) {
  const type = update?.sessionUpdate;
  if (type === "tool_call") {
    const toolMeta = update?._meta?.["x.ai/tool"] || {};
    emit({
      runId, type: "tool_call", toolCallId: update.toolCallId,
      title: update.title || toolMeta.label || toolMeta.name || "工具调用",
      toolName: toolMeta.name || update.title || "tool",
      kind: toolMeta.kind || update.kind || "other",
      readOnly: Boolean(toolMeta.read_only), input: cappedValue(update.rawInput),
      timestamp: meta.agentTimestampMs || Date.now()
    });
  } else if (type === "tool_call_update") {
    const toolMeta = update?._meta?.["x.ai/tool"] || {};
    const rawOutput = update.rawOutput || {};
    const content = toolContentText(update.content);
    const output = rawOutput.output_for_prompt || content || rawOutput.output || "";
    emit({
      runId, type: "tool_update", toolCallId: update.toolCallId,
      title: update.title || toolMeta.label || null,
      toolName: toolMeta.name || null, kind: update.kind || toolMeta.kind || null,
      status: update.status || null, input: cappedValue(update.rawInput || toolMeta.input),
      output: typeof output === "string" ? output.slice(-40_000) : JSON.stringify(output).slice(-40_000),
      exitCode: rawOutput.exit_code, currentDir: rawOutput.current_dir,
      description: rawOutput.description || null, locations: cappedValue(update.locations, 8_000),
      rawOutput: cappedValue(rawOutput, 20_000), timestamp: meta.agentTimestampMs || Date.now()
    });
  }
}

function relayLifecycleEvent(runId, event) {
  const supported = new Set(["turn_started", "loop_started", "phase_changed", "tool_started", "tool_completed", "permission_requested", "permission_resolved", "turn_ended"]);
  if (supported.has(event?.type)) emit({ runId, type: "lifecycle", event: cappedValue(event, 12_000) });
}

function startSessionUpdateBridge(runId, payload) {
  const root = sessionsRootForWorkspace(payload.cwd);
  const offsets = fileSizes(root);
  const partial = new Map();
  const expectedPrompt = effectivePrompt(payload);
  let boundSessionId = payload.sessionId || null;
  let bound = boundSessionId ? sessionFiles(root).find((item) => item.sessionId === boundSessionId) || null : null;
  let stopped = false; let polling = false;

  const consume = (file, kind, candidate) => {
    let stat;
    try { stat = fs.statSync(file); } catch { return; }
    let offset = offsets.get(file) || 0;
    if (stat.size < offset) { offset = 0; partial.set(file, ""); }
    if (stat.size === offset) return;
    let bytes;
    try { const fd = fs.openSync(file, "r"); bytes = Buffer.alloc(stat.size - offset); fs.readSync(fd, bytes, 0, bytes.length, offset); fs.closeSync(fd); } catch { return; }
    offsets.set(file, stat.size);
    const joined = `${partial.get(file) || ""}${bytes.toString("utf8")}`;
    const lines = joined.split(/\r?\n/); partial.set(file, lines.pop() || "");
    for (const line of lines) {
      if (!line.trim()) continue;
      let record; try { record = JSON.parse(line); } catch { continue; }
      if (!bound && kind === "updates") {
        const update = record?.params?.update;
        const text = update?.sessionUpdate === "user_message_chunk" ? update?.content?.text : null;
        if (typeof text === "string" && (text === expectedPrompt || text.startsWith(payload.prompt))) {
          bound = candidate; boundSessionId = candidate.sessionId;
          emit({ runId, type: "session_bound", sessionId: boundSessionId });
        }
      }
      if (!bound || candidate.sessionId !== boundSessionId) continue;
      if (kind === "updates") relaySessionUpdate(runId, record?.params?.update, record?._meta || record?.params?._meta || {});
      else relayLifecycleEvent(runId, record);
    }
  };

  const poll = () => {
    if (stopped || polling) return; polling = true;
    try {
      const candidates = bound ? [bound] : sessionFiles(root);
      for (const candidate of candidates) {
        consume(candidate.updates, "updates", candidate);
        if (bound && candidate.sessionId === boundSessionId) consume(candidate.events, "events", candidate);
      }
    } finally { polling = false; }
  };
  const timer = setInterval(poll, 120); poll();
  const bridge = {
    flush() { poll(); },
    stop(delay = 0) { setTimeout(() => { poll(); stopped = true; clearInterval(timer); sessionUpdateBridges.delete(runId); }, delay); }
  };
  sessionUpdateBridges.set(runId, bridge);
  return bridge;
}

ipcMain.handle("runtime:info", async () => runtimeInfo());

ipcMain.handle("runtime:models", async () => runtimeModels());

ipcMain.handle("config:read", () => {
  const config = readNativeConfig(grokConfigPath());
  return { ...config, integrations: integrationSummary(config.raw) };
});

ipcMain.handle("config:set", (_event, { id, value }) => {
  try {
    const result = updateNativeSetting(grokConfigPath(), id, value);
    return { ok: true, ...result, config: readNativeConfig(grokConfigPath()) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("config:save-raw", (_event, raw) => {
  try {
    const config = saveRawConfig(grokConfigPath(), raw);
    return { ok: true, ...config, integrations: integrationSummary(config.raw) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("config:open", async () => {
  const configPath = grokConfigPath();
  if (!fs.existsSync(configPath)) saveRawConfig(configPath, "# Grok Build configuration\n");
  const error = await shell.openPath(configPath);
  return { ok: !error, error: error || null };
});

ipcMain.handle("config:reveal", () => {
  const configPath = grokConfigPath();
  if (!fs.existsSync(configPath)) saveRawConfig(configPath, "# Grok Build configuration\n");
  shell.showItemInFolder(configPath);
  return true;
});

ipcMain.handle("auth:info", () => authInfo());

ipcMain.handle("auth:login", async () => {
  const binary = locateGrok();
  if (!binary) return { ok: false, error: "未检测到 Grok Runtime" };
  if (activeAuthRun) {
    if (activeAuthUrl) await shell.openExternal(activeAuthUrl);
    return { ok: true, running: true, browserOpened: Boolean(activeAuthUrl) };
  }
  const authEnv = await environmentWithSystemProxy(runtimeEnvironment(), "https://auth.x.ai/.well-known/openid-configuration");
  const child = spawn(binary, ["login", "--oauth"], {
    cwd: app.getPath("home"), windowsHide: true,
    env: authEnv, stdio: ["ignore", "pipe", "pipe"]
  });
  activeAuthRun = child;
  const openedOAuthUrls = new Set();
  let authOutputBuffer = "";
  const send = (kind, chunk) => {
    const text = String(chunk).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("auth:event", { kind, text });
    if (kind === "output") authOutputBuffer = `${authOutputBuffer}${text}`.slice(-30_000);
    for (const match of authOutputBuffer.matchAll(/https:\/\/[^\s<>"']+/gi)) {
      const raw = match[0].replace(/[),.;]+$/, "");
      try {
        const url = new URL(raw);
        if (url.hostname !== "auth.x.ai" || !url.pathname.startsWith("/oauth2/authorize") || openedOAuthUrls.has(url.href)) continue;
        openedOAuthUrls.add(url.href);
        activeAuthUrl = url.href;
        shell.openExternal(url.href).then(() => {
          if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("auth:event", { kind: "oauth-browser", text: "Runtime OAuth 授权页已打开，完成授权后会自动同步到应用" });
        }).catch((error) => send("error", error.message));
      } catch {}
    }
  };
  send("preparing", "正在连接 auth.x.ai 并生成 Runtime OAuth 授权地址…");
  child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => send("output", chunk));
  child.stderr.on("data", (chunk) => send("output", chunk));
  child.on("error", (error) => { send("error", error.message); activeAuthRun = null; activeAuthUrl = null; });
  child.on("exit", (code) => { send(code === 0 ? "complete" : "error", code === 0 ? "登录完成" : `登录进程退出：${code}`); activeAuthRun = null; activeAuthUrl = null; });
  return { ok: true, running: true, preparing: true };
});

ipcMain.handle("auth:logout", () => {
  const binary = locateGrok();
  if (!binary) return { ok: false, error: "未检测到 Grok Runtime" };
  const result = spawnSync(binary, ["logout"], { encoding: "utf8", windowsHide: true, timeout: 30_000, env: runtimeEnvironment() });
  if (result.error || result.status !== 0) return { ok: false, error: result.error?.message || result.stderr || "退出登录失败" };
  return { ok: true, info: authInfo() };
});

ipcMain.handle("providers:list", () => publicProviders());

ipcMain.handle("providers:discover", async (_event, payload) => {
  try {
    const fetchWithSystemProxy = (input, init) => session.defaultSession.fetch(input, init);
    return { ok: true, ...(await discoverModels(payload || {}, fetchWithSystemProxy)) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("providers:save", async (_event, payload) => {
  try {
    if (!payload || !Array.isArray(payload.models) || !payload.models.length) throw new Error("请至少选择一个模型");
    const store = loadProviderStore();
    const providerId = payload.id || makeProviderId(payload.baseUrl);
    const previous = store.providers.find((item) => item.id === providerId);
    const secret = String(payload.apiKey || "").trim() ? encryptApiKey(payload.apiKey) : previous?.secret;
    if (!secret) throw new Error("请填写 API 密钥");
    const provider = {
      id: providerId,
      name: payload.name || new URL(payload.baseUrl).host,
      baseUrl: payload.baseUrl,
      protocol: payload.protocol === "anthropic" ? "anthropic" : "openai",
      envKey: previous?.envKey || makeEnvKey(providerId),
      secret,
      models: payload.models.map((model) => ({
        id: String(model.id),
        name: String(model.name || model.id),
        contextWindow: Number(model.contextWindow) || null,
        maxOutput: Number(model.maxOutput) || null,
        localId: previous?.models?.find((item) => item.id === model.id)?.localId || makeLocalModelId(providerId, model.id)
      })),
      updatedAt: Date.now()
    };
    const index = store.providers.findIndex((item) => item.id === providerId);
    if (index >= 0) store.providers[index] = provider; else store.providers.push(provider);
    persistProviderStore(store);
    return { ok: true, providers: publicProviders(store) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("providers:remove", async (_event, providerId) => {
  const store = loadProviderStore();
  store.providers = store.providers.filter((provider) => provider.id !== providerId);
  persistProviderStore(store);
  return publicProviders(store);
});

ipcMain.handle("dialog:workspace", async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ["openDirectory", "createDirectory"] });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("dialog:files", async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ["openFile", "multiSelections"] });
  return result.canceled ? [] : result.filePaths;
});

ipcMain.handle("shell:reveal", async (_event, target) => {
  if (typeof target === "string" && target) shell.showItemInFolder(target);
});

ipcMain.handle("shell:open-path", async (_event, target) => {
  if (typeof target !== "string" || !target) return { ok: false, error: "路径无效" };
  const error = await shell.openPath(target);
  return error ? { ok: false, error } : { ok: true };
});

ipcMain.handle("shell:external", async (_event, target) => {
  if (typeof target === "string" && /^https?:\/\//.test(target)) await shell.openExternal(target);
});

function validWorkspace(cwd) {
  return typeof cwd === "string" && fs.existsSync(cwd) && fs.statSync(cwd).isDirectory();
}

ipcMain.handle("git:info", (_event, cwd) => readGitInfo(cwd));
ipcMain.handle("git:switch", (_event, payload) => switchGitBranch(payload?.cwd, payload?.branch));
ipcMain.handle("git:create-branch", (_event, payload) => createGitBranch(payload?.cwd, payload?.branch));

ipcMain.handle("workspace:review", async (_event, cwd) => {
  if (!validWorkspace(cwd)) return { ok: false, error: "工作区不存在" };
  const status = spawnSync("git", ["status", "--short"], { cwd, encoding: "utf8", windowsHide: true, timeout: 10_000 });
  const stat = spawnSync("git", ["diff", "--stat"], { cwd, encoding: "utf8", windowsHide: true, timeout: 10_000 });
  if (status.error) return { ok: false, error: status.error.message };
  const files = (status.stdout || "").split(/\r?\n/).filter(Boolean).map((line) => ({ status: line.slice(0, 2), path: line.slice(3) }));
  return { ok: true, files, stat: (stat.stdout || "").trim(), clean: files.length === 0 };
});

ipcMain.handle("workspace:list", async (_event, { cwd, dir = "" }) => {
  if (!validWorkspace(cwd)) return { ok: false, error: "工作区不存在" };
  const ignored = new Set(["node_modules", "target", "dist", ".idea", ".vscode"]);
  const base = path.resolve(cwd);
  const target = path.resolve(cwd, String(dir || "."));
  const relativeRoot = path.relative(base, target);
  if (relativeRoot.startsWith("..") || path.isAbsolute(relativeRoot)) return { ok: false, error: "目录超出工作区" };
  try {
    const entries = fs.readdirSync(target, { withFileTypes: true })
      .filter((entry) => !ignored.has(entry.name) && !entry.name.startsWith(".preview-"))
      .map((entry) => {
        const absolute = path.join(target, entry.name);
        const relative = path.relative(base, absolute).replace(/\\/g, "/");
        let size = 0;
        try { if (entry.isFile()) size = fs.statSync(absolute).size; } catch {}
        return { name: entry.name, path: relative, type: entry.isDirectory() ? "dir" : "file", size };
      })
      .sort((a, b) => Number(a.type === "file") - Number(b.type === "file") || a.name.localeCompare(b.name));
    return { ok: true, dir: relativeRoot.replace(/\\/g, "/") || "", entries };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("workspace:files", async (_event, cwd) => {
  if (!validWorkspace(cwd)) return { ok: false, error: "工作区不存在" };
  const ignored = new Set([".git", "node_modules", "target", "dist", ".idea", ".vscode"]);
  const files = [];
  const walk = (directory, depth = 0) => {
    if (files.length >= 600 || depth > 8) return;
    let entries = [];
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => Number(a.isFile()) - Number(b.isFile()) || a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (files.length >= 600 || ignored.has(entry.name) || entry.name.startsWith(".preview-")) continue;
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(cwd, absolute).replace(/\\/g, "/");
      if (entry.isDirectory()) walk(absolute, depth + 1);
      else if (entry.isFile()) files.push({ path: relative, size: fs.statSync(absolute).size });
    }
  };
  walk(cwd);
  return { ok: true, files, truncated: files.length >= 600 };
});

ipcMain.handle("workspace:read", async (_event, { cwd, file }) => {
  if (!validWorkspace(cwd) || typeof file !== "string") return { ok: false, error: "文件路径无效" };
  const target = path.resolve(cwd, file);
  const relative = path.relative(path.resolve(cwd), target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return { ok: false, error: "文件超出工作区" };
  try {
    const stat = fs.statSync(target);
    if (!stat.isFile()) throw new Error("目标不是文件");
    if (stat.size > 1024 * 1024) throw new Error("文件超过 1 MB，请在系统编辑器中打开");
    const buffer = fs.readFileSync(target);
    if (buffer.includes(0)) throw new Error("这是二进制文件");
    return { ok: true, content: buffer.toString("utf8"), size: stat.size };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

function emitTerminal(data) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("terminal:event", data);
}

function closeTerminalSession(terminalId) {
  const session = terminalSessions.get(terminalId);
  if (!session) return false;
  terminalSessions.delete(terminalId);
  session.closing = true;
  try { session.child.stdin.end(); } catch {}
  try { session.child.kill(); } catch {}
  return true;
}

ipcMain.handle("terminal:create", async (_event, { terminalId, cwd }) => {
  if (typeof terminalId !== "string" || !terminalId || !validWorkspace(cwd)) return { ok: false, error: "终端参数无效" };
  const existing = terminalSessions.get(terminalId);
  if (existing && !existing.child.killed) return { ok: true, terminalId, cwd: existing.cwd, shell: existing.shell };
  const shellExe = process.platform === "win32" ? "powershell.exe" : (process.env.SHELL || "/bin/sh");
  const shellArgs = process.platform === "win32"
    ? ["-NoLogo", "-NoProfile", "-NoExit", "-ExecutionPolicy", "Bypass", "-Command", "-"]
    : ["-l"];
  try {
    const child = spawn(shellExe, shellArgs, {
      cwd,
      windowsHide: true,
      env: runtimeEnvironment({ TERM: process.env.TERM || "xterm-256color" }),
      stdio: ["pipe", "pipe", "pipe"]
    });
    const session = { terminalId, cwd, shell: path.basename(shellExe), child, closing: false };
    terminalSessions.set(terminalId, session);
    const forward = (stream, kind) => {
      stream.setEncoding("utf8");
      stream.on("data", (data) => emitTerminal({ terminalId, type: "output", kind, data: String(data) }));
    };
    forward(child.stdout, "stdout");
    forward(child.stderr, "stderr");
    child.on("error", (error) => emitTerminal({ terminalId, type: "error", message: error.message }));
    child.on("exit", (code, signal) => {
      if (terminalSessions.get(terminalId)?.child === child) terminalSessions.delete(terminalId);
      emitTerminal({ terminalId, type: "exit", code, signal, closing: session.closing });
    });
    if (process.platform === "win32") {
      child.stdin.write("[Console]::OutputEncoding = [Text.UTF8Encoding]::new(); $OutputEncoding = [Text.UTF8Encoding]::new()\n");
    }
    return { ok: true, terminalId, cwd, shell: session.shell };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("terminal:write", async (_event, { terminalId, data }) => {
  const session = terminalSessions.get(terminalId);
  if (!session || session.child.killed) return { ok: false, error: "终端会话已结束" };
  if (typeof data !== "string" || data.length > 100_000) return { ok: false, error: "终端输入无效" };
  try { session.child.stdin.write(data); return { ok: true }; } catch (error) { return { ok: false, error: error.message }; }
});

ipcMain.handle("terminal:close", (_event, terminalId) => ({ ok: true, closed: closeTerminalSession(terminalId) }));

ipcMain.handle("terminal:run", async (_event, { cwd, command }) => {
  if (!validWorkspace(cwd) || typeof command !== "string" || !command.trim()) return { ok: false, error: "请输入命令" };
  return new Promise((resolve) => {
    const shellExe = process.platform === "win32" ? "powershell.exe" : "/bin/sh";
    const shellArgs = process.platform === "win32"
      ? ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", `[Console]::OutputEncoding = [Text.UTF8Encoding]::new(); ${command}`]
      : ["-lc", command];
    const child = spawn(shellExe, shellArgs, { cwd, windowsHide: true, env: runtimeEnvironment() });
    let stdout = ""; let stderr = ""; let settled = false;
    const cap = (current, chunk) => `${current}${chunk}`.slice(-200_000);
    child.stdout.on("data", (chunk) => { stdout = cap(stdout, chunk); });
    child.stderr.on("data", (chunk) => { stderr = cap(stderr, chunk); });
    const timer = setTimeout(() => { if (!settled) child.kill(); }, 30_000);
    child.on("error", (error) => { settled = true; clearTimeout(timer); resolve({ ok: false, error: error.message }); });
    child.on("exit", (code) => { if (settled) return; settled = true; clearTimeout(timer); resolve({ ok: true, code, stdout, stderr }); });
  });
});

ipcMain.handle("grok:prompt", async (_event, payload) => {
  const binary = locateGrok();
  if (!binary) return { ok: false, error: "Grok runtime was not found. Set GROK_BINARY or install the grok CLI." };
  if (!payload || typeof payload.prompt !== "string" || !payload.prompt.trim()) {
    return { ok: false, error: "Prompt is empty." };
  }
  if (!payload.cwd || !fs.existsSync(payload.cwd)) return { ok: false, error: "Workspace path does not exist." };

  const runId = crypto.randomUUID();
  runClients.set(runId, String(payload.clientId || "main"));
  const runtimeEnv = await environmentWithSystemProxy(runtimeEnvironment(), runtimeTargetUrl(payload.model));
  const run = new AcpAgentRun({
    binary,
    cwd: payload.cwd,
    env: {
      ...runtimeEnv,
      GROK_LAUNCH_SOURCE: "grok-desktop",
      GROK_CLIENT_NAME: "grok-desktop"
    },
    alwaysApprove: Boolean(payload.alwaysApprove),
    model: payload.model,
    effort: payload.effort,
    sessionId: payload.sessionId || null,
    prompt: effectivePrompt(payload)
  });
  run.on("event", (data) => emit({ runId, ...data }));
  const child = run.start();
  activeRuns.set(runId, child);
  acpRuns.set(runId, run);
  child.on("exit", () => {
    acpRuns.delete(runId);
    activeRuns.delete(runId);
    setTimeout(() => runClients.delete(runId), 1_200);
  });
  return { ok: true, runId };
});

ipcMain.handle("grok:permission-respond", async (_event, payload) => {
  const run = acpRuns.get(payload?.runId);
  if (!run) return { ok: false, error: "当前没有可应答的 Agent 会话" };
  return run.respondPermission({
    toolCallId: payload?.toolCallId,
    optionId: payload?.optionId,
    cancelled: Boolean(payload?.cancelled)
  });
});

ipcMain.handle("grok:cancel", async (_event, runId) => {
  const run = acpRuns.get(runId);
  if (run) {
    run.cancel();
    acpRuns.delete(runId);
    activeRuns.delete(runId);
    return true;
  }
  const child = activeRuns.get(runId);
  if (!child) return false;
  child.kill();
  activeRuns.delete(runId);
  return true;
});

ipcMain.on("window:minimize", () => mainWindow?.minimize());
ipcMain.on("window:maximize", () => {
  if (!mainWindow) return;
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
});
ipcMain.on("window:close", () => mainWindow?.close());

function createWindow() {
  nativeTheme.themeSource = "system";
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 960,
    minWidth: 920,
    minHeight: 650,
    show: false,
    title: "Grok Build",
    icon: path.join(__dirname, "build", "icon.png"),
    backgroundColor: "#080a0b",
    titleBarStyle: "hidden",
    titleBarOverlay: process.platform === "darwin" ? false : { color: "#00000000", symbolColor: "#9ba3a8", height: 44 },
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true
    }
  });
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-attach-webview", (_event, webPreferences) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
  });
  mainWindow.webContents.on("did-attach-webview", (_event, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
      return { action: "deny" };
    });
  });
}

app.whenReady().then(async () => {
  await refreshSystemProxyEnvironment("https://auth.x.ai/.well-known/openid-configuration");
  createWindow();
});
app.on("window-all-closed", () => {
  for (const child of activeRuns.values()) child.kill();
  for (const bridge of sessionUpdateBridges.values()) bridge.stop();
  for (const terminalId of [...terminalSessions.keys()]) closeTerminalSession(terminalId);
  if (activeAuthRun) { activeAuthRun.kill(); activeAuthRun = null; activeAuthUrl = null; }
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
