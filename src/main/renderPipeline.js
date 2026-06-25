const os = require("os");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const { Worker } = require("worker_threads");
const { getFfmpegPath, pickEncoder, encoderArgs } = require("./ffmpegUtil");
const { analyzePlaylist } = require("./audioAnalysis");
const { RESOLUTIONS } = require("../shared/constants");

function tmpFile(name) {
  return path.join(os.tmpdir(), `mrs_${Date.now()}_${name}`);
}

// Concats all tracks (in render order) into one continuous audio file, re-encoding
// everything to AAC so differing source codecs/sample rates don't matter.
function concatAudio(tracks, outPath) {
  return new Promise((resolve, reject) => {
    const args = ["-y"];
    tracks.forEach((t) => args.push("-i", t.path));
    const filterInputs = tracks.map((_, i) => `[${i}:a]`).join("");
    const filter = `${filterInputs}concat=n=${tracks.length}:v=0:a=1[aout]`;
    args.push("-filter_complex", filter, "-map", "[aout]", "-c:a", "aac", "-b:a", "192k", outPath);
    const ff = spawn(getFfmpegPath(), args);
    let err = "";
    ff.stderr.on("data", (d) => (err += d.toString()));
    ff.on("close", (code) => (code === 0 ? resolve() : reject(new Error("concat audio failed: " + err.slice(-1500)))));
  });
}

function muxVideoAudio(videoPath, audioPath, outPath, codec) {
  return new Promise((resolve, reject) => {
    const audioCodec = codec === "webm" ? ["-c:a", "libopus"] : ["-c:a", "aac"];
    const args = ["-y", "-i", videoPath, "-i", audioPath, "-c:v", "copy", ...audioCodec, "-shortest", outPath];
    const ff = spawn(getFfmpegPath(), args);
    let err = "";
    ff.stderr.on("data", (d) => (err += d.toString()));
    ff.on("close", (code) => (code === 0 ? resolve() : reject(new Error("mux failed: " + err.slice(-1500)))));
  });
}

async function runRender(config, fontsDir, send) {
  // config: { tracks:[{path,duration}], aspectRatio, resolution, codec, fps, bg, logo, title, subtitle, spectrum, outputPath }
  const [w, h] = RESOLUTIONS[config.aspectRatio][config.resolution];
  const fps = config.fps;

  send({ type: "stage", stage: "analyzing", label: "Menganalisis spektrum audio (offline, sekali jalan)..." });
  const framesData = await analyzePlaylist(config.tracks, fps, config.spectrum.bars, (p) =>
    send({ type: "stage", stage: "analyzing", label: `Menganalisis track ${p.trackIndex + 1}/${p.of}...` })
  );
  const totalFrames = framesData.length;

  send({ type: "stage", stage: "concat", label: "Menggabungkan audio playlist..." });
  const concatAudioPath = tmpFile("audio.m4a");
  await concatAudio(config.tracks, concatAudioPath);

  send({ type: "stage", stage: "encoder", label: "Mendeteksi encoder GPU yang tersedia..." });
  const { encoder, hardware } = await pickEncoder(config.codec);
  const encArgs = encoderArgs(encoder, config.resolution);

  const tmpVideoPath = tmpFile(config.codec === "webm" ? "video.webm" : "video.mp4");

  send({ type: "stage", stage: "render", label: `Merender frame (encoder: ${encoder}${hardware ? ", GPU" : ", CPU"})...` });

  await new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, "renderWorker.js"), {
      workerData: {
        width: w, height: h, fps, outFps: fps, totalFrames,
        ffmpegPath: getFfmpegPath(), encoder, encoderArgs: encArgs,
        tmpVideoPath, bg: config.bg, logo: config.logo, title: config.title,
        subtitle: config.subtitle, spectrum: config.spectrum, fontsDir, framesData,
      },
    });
    worker.on("message", (msg) => {
      if (msg.type === "progress") {
        send({ type: "progress", percent: (msg.frame / msg.totalFrames) * 100, speedMultiplier: msg.speedMultiplier, encoder: msg.encoder });
      } else if (msg.type === "video-encoded") {
        resolve();
      } else if (msg.type === "error") {
        reject(new Error(msg.message));
      }
    });
    worker.on("error", reject);
  });

  send({ type: "stage", stage: "mux", label: "Menggabungkan video + audio final..." });
  await muxVideoAudio(tmpVideoPath, concatAudioPath, config.outputPath, config.codec);

  try { fs.unlinkSync(tmpVideoPath); } catch (e) {}
  try { fs.unlinkSync(concatAudioPath); } catch (e) {}

  const stat = fs.statSync(config.outputPath);
  send({ type: "done", outputPath: config.outputPath, sizeMB: (stat.size / 1024 / 1024).toFixed(1), encoder, hardware, totalFrames, fps });
}

module.exports = { runRender };
