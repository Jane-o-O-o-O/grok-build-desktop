const { app, BrowserWindow, dialog, ipcMain, shell, nativeTheme, safeStorage } = require("electron");
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
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
let mainWindow;
let activeAuthRun = null;

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
  const count = (prefix) => new Set(sectionNames.filter((name) => name.startsWith(prefix)).map((name) => name.split(".").slice(0, 2).join("."))).size;
  const directoryCount = (name) => {
    const target = path.join(grokHomePath(), name);
    try { return fs.readdirSync(target, { withFileTypes: true }).filter((entry) => !entry.name.startsWith(".")).length; } catch { return 0; }
  };
  return {
    mcp: count("mcp_servers."),
    models: count("model."),
    plugins: directoryCount("plugins"),
    skills: directoryCount("skills"),
    hooks: directoryCount("hooks"),
    agents: directoryCount("agents")
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

function runtimeInfo() {
  const binary = locateGrok();
  let version = null;
  let models = [];
  let defaultModel = null;
  if (binary) {
    const env = { ...process.env, ...providerEnvironment() };
    const result = spawnSync(binary, ["--version"], { encoding: "utf8", windowsHide: true, timeout: 5000, env });
    version = (result.stdout || result.stderr || "").trim() || null;
    const modelResult = spawnSync(binary, ["models"], { encoding: "utf8", windowsHide: true, timeout: 10000, env });
    const modelOutput = `${modelResult.stdout || ""}\n${modelResult.stderr || ""}`;
    defaultModel = modelOutput.match(/Default model:\s*([^\s]+)/i)?.[1] || null;
    models = [...modelOutput.matchAll(/^\s*\*\s+([^\s(]+)/gm)].map((match) => match[1]);
  }
  return {
    connected: Boolean(binary),
    binary,
    version,
    models,
    defaultModel,
    platform: process.platform,
    packaged: app.isPackaged,
    defaultCwd: app.isPackaged ? app.getPath("documents") : path.resolve(__dirname, "..")
  };
}

function emit(data) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("grok:event", data);
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
    emit({ runId, ...event });
  } catch {
    emit({ runId, type: "text", data: line });
  }
}

function buildArgs(payload) {
  const args = ["--cwd", payload.cwd, "-p", payload.prompt, "--output-format", "streaming-json"];
  if (payload.sessionId) args.push("--resume", payload.sessionId);
  if (payload.model && payload.model !== "auto") args.push("--model", payload.model);
  if (payload.effort && payload.effort !== "auto") args.push("--reasoning-effort", payload.effort);
  if (payload.alwaysApprove) args.push("--always-approve");
  if (Array.isArray(payload.attachments) && payload.attachments.length) {
    const attachmentNote = payload.attachments.map((file) => `- ${file}`).join("\n");
    args[args.indexOf("-p") + 1] += `\n\nAttached local files:\n${attachmentNote}`;
  }
  return args;
}

ipcMain.handle("runtime:info", () => runtimeInfo());

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

ipcMain.handle("auth:login", () => {
  const binary = locateGrok();
  if (!binary) return { ok: false, error: "未检测到 Grok Runtime" };
  if (activeAuthRun) return { ok: true, running: true };
  const child = spawn(binary, ["login", "--oauth"], {
    cwd: app.getPath("home"), windowsHide: true,
    env: { ...process.env, ...providerEnvironment() }, stdio: ["ignore", "pipe", "pipe"]
  });
  activeAuthRun = child;
  const send = (kind, chunk) => {
    const text = String(chunk).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("auth:event", { kind, text });
  };
  child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => send("output", chunk));
  child.stderr.on("data", (chunk) => send("output", chunk));
  child.on("error", (error) => { send("error", error.message); activeAuthRun = null; });
  child.on("exit", (code) => { send(code === 0 ? "complete" : "error", code === 0 ? "登录完成" : `登录进程退出：${code}`); activeAuthRun = null; });
  return { ok: true, running: true };
});

ipcMain.handle("auth:logout", () => {
  const binary = locateGrok();
  if (!binary) return { ok: false, error: "未检测到 Grok Runtime" };
  const result = spawnSync(binary, ["logout"], { encoding: "utf8", windowsHide: true, timeout: 30_000, env: { ...process.env, ...providerEnvironment() } });
  if (result.error || result.status !== 0) return { ok: false, error: result.error?.message || result.stderr || "退出登录失败" };
  return { ok: true, info: authInfo() };
});

ipcMain.handle("providers:list", () => publicProviders());

ipcMain.handle("providers:discover", async (_event, payload) => {
  try {
    return { ok: true, ...(await discoverModels(payload || {})) };
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

ipcMain.handle("terminal:run", async (_event, { cwd, command }) => {
  if (!validWorkspace(cwd) || typeof command !== "string" || !command.trim()) return { ok: false, error: "请输入命令" };
  return new Promise((resolve) => {
    const shellExe = process.platform === "win32" ? "powershell.exe" : "/bin/sh";
    const shellArgs = process.platform === "win32"
      ? ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", `[Console]::OutputEncoding = [Text.UTF8Encoding]::new(); ${command}`]
      : ["-lc", command];
    const child = spawn(shellExe, shellArgs, { cwd, windowsHide: true, env: { ...process.env, ...providerEnvironment() } });
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
  const child = spawn(binary, buildArgs(payload), {
    cwd: payload.cwd,
    windowsHide: true,
    env: {
      ...process.env,
      ...providerEnvironment(),
      GROK_LAUNCH_SOURCE: "grok-desktop",
      GROK_CLIENT_NAME: "grok-desktop"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  activeRuns.set(runId, child);
  parseLines(runId, child.stdout, "stdout");
  parseLines(runId, child.stderr, "stderr");
  child.on("error", (error) => emit({ runId, type: "error", message: error.message }));
  child.on("exit", (code, signal) => {
    activeRuns.delete(runId);
    emit({ runId, type: "process_exit", code, signal });
  });
  return { ok: true, runId };
});

ipcMain.handle("grok:cancel", async (_event, runId) => {
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

app.whenReady().then(createWindow);
app.on("window-all-closed", () => {
  for (const child of activeRuns.values()) child.kill();
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
