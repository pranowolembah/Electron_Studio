const { ipcMain, dialog, app, BrowserWindow } = require("electron");
const path = require("path");
const { runRender } = require("./renderPipeline");
const { ALL_FONTS } = require("../shared/constants");

function getFontsDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "fonts")
    : path.join(__dirname, "..", "..", "resources", "fonts");
}

ipcMain.handle("pick-audio-files", async () => {
  const res = await dialog.showOpenDialog({
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "Audio", extensions: ["mp3", "wav", "m4a", "aac", "flac", "ogg"] }],
  });
  return res.canceled ? [] : res.filePaths;
});

ipcMain.handle("pick-image", async () => {
  const res = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg", "webp"] }],
  });
  return res.canceled ? null : res.filePaths[0];
});

ipcMain.handle("pick-image-or-video", async () => {
  const res = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [{ name: "Media", extensions: ["png", "jpg", "jpeg", "webp", "mp4", "mov", "mkv", "webm"] }],
  });
  if (res.canceled) return null;
  const p = res.filePaths[0];
  const kind = /\.(mp4|mov|mkv|webm)$/i.test(p) ? "video" : "image";
  return { path: p, kind };
});

ipcMain.handle("pick-output-path", async (_e, ext) => {
  const res = await dialog.showSaveDialog({
    defaultPath: `playlist-video.${ext}`,
    filters: [{ name: "Video", extensions: [ext] }],
  });
  return res.canceled ? null : res.filePath;
});

ipcMain.handle("get-font-list", () => ALL_FONTS);

ipcMain.handle("start-render", async (event, config) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const send = (payload) => {
    if (payload.type === "stage") win.webContents.send("render-stage", payload);
    else if (payload.type === "progress") win.webContents.send("render-progress", payload);
    else if (payload.type === "done") win.webContents.send("render-done", payload);
  };
  try {
    await runRender(config, getFontsDir(), send);
  } catch (err) {
    win.webContents.send("render-error", { message: err.message });
  }
  return true;
});

ipcMain.handle("cancel-render", () => {
  // Render currently runs to completion within a single invoke call; a future version
  // can track the active Worker/ffmpeg PIDs here and kill them on cancel.
  return true;
});
