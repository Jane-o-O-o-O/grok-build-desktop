const { contextBridge, ipcRenderer } = require("electron");

const listeners = new Map();

contextBridge.exposeInMainWorld("grokDesktop", {
  platform: process.platform,
  runtimeInfo: () => ipcRenderer.invoke("runtime:info"),
  pickWorkspace: () => ipcRenderer.invoke("dialog:workspace"),
  pickFiles: () => ipcRenderer.invoke("dialog:files"),
  revealPath: (path) => ipcRenderer.invoke("shell:reveal", path),
  openExternal: (url) => ipcRenderer.invoke("shell:external", url),
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
  }
});
