const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  pickAudioFiles: () => ipcRenderer.invoke("pick-audio-files"),
  pickImage: () => ipcRenderer.invoke("pick-image"),
  pickImageOrVideo: () => ipcRenderer.invoke("pick-image-or-video"),
  pickOutputPath: (ext) => ipcRenderer.invoke("pick-output-path", ext),
  getFontList: () => ipcRenderer.invoke("get-font-list"),

  startRender: (config) => ipcRenderer.invoke("start-render", config),
  cancelRender: () => ipcRenderer.invoke("cancel-render"),

  onStage: (cb) => ipcRenderer.on("render-stage", (_e, data) => cb(data)),
  onProgress: (cb) => ipcRenderer.on("render-progress", (_e, data) => cb(data)),
  onDone: (cb) => ipcRenderer.on("render-done", (_e, data) => cb(data)),
  onError: (cb) => ipcRenderer.on("render-error", (_e, data) => cb(data)),
});
