const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const { app } = require("electron");

function getFfmpegPath() {
  // Dev mode: looks in resources/ffmpeg/ next to project root.
  // Packaged mode: looks in resources/ffmpeg/ next to the installed app (extraResources).
  const exeName = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  const candidates = [
    path.join(process.resourcesPath || "", "ffmpeg", exeName),
    path.join(__dirname, "..", "..", "resources", "ffmpeg", exeName),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  // fall back to PATH (user installed ffmpeg globally)
  return "ffmpeg";
}

let cachedEncoders = null;
function detectEncoders() {
  return new Promise((resolve) => {
    if (cachedEncoders) return resolve(cachedEncoders);
    const ff = spawn(getFfmpegPath(), ["-hide_banner", "-encoders"]);
    let out = "";
    ff.stdout.on("data", (d) => (out += d.toString()));
    ff.stderr.on("data", (d) => (out += d.toString()));
    ff.on("close", () => {
      const found = {};
      for (const name of [
        "h264_nvenc", "hevc_nvenc", "h264_qsv", "hevc_qsv",
        "h264_amf", "hevc_amf", "libx264", "libx265", "libvpx-vp9", "libvpx",
      ]) {
        found[name] = out.includes(name);
      }
      cachedEncoders = found;
      resolve(found);
    });
    ff.on("error", () => resolve({}));
  });
}

// Picks the fastest available encoder for a requested codec family, preferring GPU.
async function pickEncoder(codecChoice) {
  const enc = await detectEncoders();
  const priority = {
    h264: ["h264_nvenc", "h264_qsv", "h264_amf", "libx264"],
    hevc: ["hevc_nvenc", "hevc_qsv", "hevc_amf", "libx265", "libx264"], // falls back to h264 if no hevc encoder at all
    webm: ["libvpx-vp9", "libvpx"],
  };
  const list = priority[codecChoice] || priority.webm;
  for (const name of list) {
    if (enc[name]) return { encoder: name, hardware: name.includes("nvenc") || name.includes("qsv") || name.includes("amf") };
  }
  return { encoder: "libx264", hardware: false };
}

function encoderArgs(encoder, resolution) {
  const bitrate = resolution >= 2160 ? "32M" : resolution >= 1440 ? "16M" : "8M";
  if (encoder.includes("nvenc")) return ["-c:v", encoder, "-preset", "p4", "-b:v", bitrate];
  if (encoder.includes("qsv")) return ["-c:v", encoder, "-b:v", bitrate];
  if (encoder.includes("amf")) return ["-c:v", encoder, "-b:v", bitrate];
  if (encoder === "libx265") return ["-c:v", "libx265", "-preset", "fast", "-b:v", bitrate];
  if (encoder === "libvpx-vp9") return ["-c:v", "libvpx-vp9", "-b:v", bitrate, "-row-mt", "1"];
  return ["-c:v", "libx264", "-preset", "veryfast", "-b:v", bitrate, "-pix_fmt", "yuv420p"];
}

module.exports = { getFfmpegPath, detectEncoders, pickEncoder, encoderArgs, spawn };
