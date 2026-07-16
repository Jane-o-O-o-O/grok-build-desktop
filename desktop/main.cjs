const { app, BrowserWindow, dialog, ipcMain, shell, nativeTheme } = require("electron");
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const activeRuns = new Map();
let mainWindow;

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
    const result = spawnSync(binary, ["--version"], { encoding: "utf8", windowsHide: true, timeout: 5000 });
    version = (result.stdout || result.stderr || "").trim() || null;
    const modelResult = spawnSync(binary, ["models"], { encoding: "utf8", windowsHide: true, timeout: 10000 });
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
      sandbox: true
    }
  });
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
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
