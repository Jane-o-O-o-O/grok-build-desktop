const { contextBridge, ipcRenderer } = require("electron");

const listeners = new Map();

contextBridge.exposeInMainWorld("grokDesktop", {
  platform: process.platform,
  runtimeInfo: () => ipcRenderer.invoke("runtime:info"),
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
  saveProvider: (payload) => ipcRenderer.invoke("providers:save", payload),
  removeProvider: (providerId) => ipcRenderer.invoke("providers:remove", providerId),
  pickWorkspace: () => ipcRenderer.invoke("dialog:workspace"),
  pickFiles: () => ipcRenderer.invoke("dialog:files"),
  revealPath: (path) => ipcRenderer.invoke("shell:reveal", path),
  openExternal: (url) => ipcRenderer.invoke("shell:external", url),
  gitInfo: (cwd) => ipcRenderer.invoke("git:info", cwd),
  switchGitBranch: (cwd, branch) => ipcRenderer.invoke("git:switch", { cwd, branch }),
  createGitBranch: (cwd, branch) => ipcRenderer.invoke("git:create-branch", { cwd, branch }),
  reviewWorkspace: (cwd) => ipcRenderer.invoke("workspace:review", cwd),
  listWorkspaceFiles: (cwd) => ipcRenderer.invoke("workspace:files", cwd),
  readWorkspaceFile: (cwd, file) => ipcRenderer.invoke("workspace:read", { cwd, file }),
  runTerminalCommand: (cwd, command) => ipcRenderer.invoke("terminal:run", { cwd, command }),
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
  }
});
