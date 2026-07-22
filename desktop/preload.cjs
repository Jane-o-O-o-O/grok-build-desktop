const { contextBridge, ipcRenderer, webUtils } = require("electron");

const listeners = new Map();

contextBridge.exposeInMainWorld("grokDesktop", {
  platform: process.platform,
  runtimeInfo: () => ipcRenderer.invoke("runtime:info"),
  runtimeModels: () => ipcRenderer.invoke("runtime:models"),
  pickRuntimeBinary: () => ipcRenderer.invoke("runtime:pick-binary"),
  clearRuntimeBinary: () => ipcRenderer.invoke("runtime:clear-binary"),
  readNativeConfig: () => ipcRenderer.invoke("config:read"),
  setNativeSetting: (id, value) => ipcRenderer.invoke("config:set", { id, value }),
  saveRawConfig: (raw) => ipcRenderer.invoke("config:save-raw", raw),
  openNativeConfig: () => ipcRenderer.invoke("config:open"),
  revealNativeConfig: () => ipcRenderer.invoke("config:reveal"),
  authInfo: () => ipcRenderer.invoke("auth:info"),
  login: () => ipcRenderer.invoke("auth:login"),
  logout: () => ipcRenderer.invoke("auth:logout"),
  listProviders: () => ipcRenderer.invoke("providers:list"),
  discoverProviderModels: (payload) => ipcRenderer.invoke("providers:discover", payload),
  probeProviderModel: (payload) => ipcRenderer.invoke("providers:probe", payload),
  probeAllProviderModels: (providerId) => ipcRenderer.invoke("providers:probe-all", providerId),
  refreshProviderModels: (providerId) => ipcRenderer.invoke("providers:refresh", providerId),
  saveProvider: (payload) => ipcRenderer.invoke("providers:save", payload),
  setProviderModelsEnabled: (providerId, modelIds) => ipcRenderer.invoke("providers:set-enabled", { providerId, modelIds }),
  removeProvider: (providerId) => ipcRenderer.invoke("providers:remove", providerId),
  pickWorkspace: () => ipcRenderer.invoke("dialog:workspace"),
  pickFiles: () => ipcRenderer.invoke("dialog:files"),
  pathForFile: (file) => webUtils.getPathForFile(file),
  saveClipboardImage: (payload) => ipcRenderer.invoke("attachments:save-clipboard-image", payload),
  validateAttachmentPaths: (paths) => ipcRenderer.invoke("attachments:validate-paths", paths),
  revealPath: (path) => ipcRenderer.invoke("shell:reveal", path),
  openPath: (path) => ipcRenderer.invoke("shell:open-path", path),
  openExternal: (url) => ipcRenderer.invoke("shell:external", url),
  gitInfo: (cwd) => ipcRenderer.invoke("git:info", cwd),
  switchGitBranch: (cwd, branch) => ipcRenderer.invoke("git:switch", { cwd, branch }),
  createGitBranch: (cwd, branch) => ipcRenderer.invoke("git:create-branch", { cwd, branch }),
  resolveWorkspace: (cwd) => ipcRenderer.invoke("workspace:resolve", cwd),
  reviewWorkspace: (cwd) => ipcRenderer.invoke("workspace:review", cwd),
  listWorkspaceFiles: (cwd) => ipcRenderer.invoke("workspace:files", cwd),
  listWorkspaceDir: (cwd, dir) => ipcRenderer.invoke("workspace:list", { cwd, dir }),
  readWorkspaceFile: (cwd, file) => ipcRenderer.invoke("workspace:read", { cwd, file }),
  writeWorkspaceFile: (cwd, file, content) => ipcRenderer.invoke("workspace:write", { cwd, file, content }),
  runTerminalCommand: (cwd, command) => ipcRenderer.invoke("terminal:run", { cwd, command }),
  createTerminal: (terminalId, cwd) => ipcRenderer.invoke("terminal:create", { terminalId, cwd }),
  writeTerminal: (terminalId, data) => ipcRenderer.invoke("terminal:write", { terminalId, data }),
  closeTerminal: (terminalId) => ipcRenderer.invoke("terminal:close", terminalId),
  sendPrompt: (payload) => ipcRenderer.invoke("grok:prompt", payload),
  cancelPrompt: (runId) => ipcRenderer.invoke("grok:cancel", runId),
  minimize: () => ipcRenderer.send("window:minimize"),
  maximize: () => ipcRenderer.send("window:maximize"),
  close: () => ipcRenderer.send("window:close"),
  onRunEvent: (callback) => {
    const wrapped = (_event, data) => callback(data);
    listeners.set(callback, wrapped);
    ipcRenderer.on("grok:event", wrapped);
    return () => {
      ipcRenderer.removeListener("grok:event", wrapped);
      listeners.delete(callback);
    };
  },
  onAuthEvent: (callback) => {
    const wrapped = (_event, data) => callback(data);
    listeners.set(callback, wrapped);
    ipcRenderer.on("auth:event", wrapped);
    return () => {
      ipcRenderer.removeListener("auth:event", wrapped);
      listeners.delete(callback);
    };
  },
  onProviderEvent: (callback) => {
    const wrapped = (_event, data) => callback(data);
    listeners.set(callback, wrapped);
    ipcRenderer.on("providers:event", wrapped);
    return () => {
      ipcRenderer.removeListener("providers:event", wrapped);
      listeners.delete(callback);
    };
  },
  onTerminalEvent: (callback) => {
    const wrapped = (_event, data) => callback(data);
    listeners.set(callback, wrapped);
    ipcRenderer.on("terminal:event", wrapped);
    return () => {
      ipcRenderer.removeListener("terminal:event", wrapped);
      listeners.delete(callback);
    };
  }
});
