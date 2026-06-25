const { parentPort, workerData } = require("worker_threads");
const fs = require("fs");
const path = require("path");
const { createCanvas, loadImage, registerFont, Image } = require("canvas");
const { spawn } = require("child_process");
const draw = require("../shared/drawing");
const { ALL_FONTS } = require("../shared/constants");

function post(msg) { parentPort.postMessage(msg); }

// --- helper: pulls fixed-size frames out of a continuous ffmpeg rawvideo stdout stream ---
class FrameSource {
  constructor(stream, frameSize) {
    this.stream = stream;
    this.frameSize = frameSize;
    this.buf = Buffer.alloc(0);
    this.queue = [];
    this.waiters = [];
    this.ended = false;
    stream.on("data", (d) => {
      this.buf = Buffer.concat([this.buf, d]);
      while (this.buf.length >= this.frameSize) {
        this.queue.push(this.buf.subarray(0, this.frameSize));
        this.buf = this.buf.subarray(this.frameSize);
      }
      this._flush();
    });
    stream.on("end", () => { this.ended = true; this._flush(); });
  }
  _flush() {
    while (this.waiters.length && (this.queue.length || this.ended)) {
      const resolve = this.waiters.shift();
      resolve(this.queue.shift() || null);
    }
  }
  next() {
    if (this.queue.length) return Promise.resolve(this.queue.shift());
    if (this.ended) return Promise.resolve(null);
    return new Promise((resolve) => this.waiters.push(resolve));
  }
}

async function run() {
  const {
    width, height, fps, outFps, totalFrames, ffmpegPath, encoder, encoderArgs,
    tmpVideoPath, bg, logo, title, subtitle, spectrum, fontsDir, framesData,
  } = workerData;

  // register bundled fonts (skip silently if a file is missing)
  for (const f of ALL_FONTS) {
    const p = path.join(fontsDir, f.file);
    if (fs.existsSync(p)) {
      try { registerFont(p, { family: f.family }); } catch (e) { /* ignore */ }
    }
  }

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  // preload static media
  let logoImg = null;
  if (logo.url && fs.existsSync(logo.url)) logoImg = await loadImage(logo.url);

  let bgStaticImg = null;
  let bgFrameSource = null;
  let bgFrameSize = 0;
  if (bg.type === "custom" && bg.url) {
    if (bg.kind === "image") {
      bgStaticImg = await loadImage(bg.url);
    } else if (bg.kind === "video") {
      bgFrameSize = width * height * 4;
      const bgFf = spawn(ffmpegPath, [
        "-stream_loop", "-1", "-i", bg.url,
        "-vf", `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`,
        "-r", String(fps), "-f", "rawvideo", "-pix_fmt", "rgba",
        "-frames:v", String(totalFrames), "-",
      ]);
      bgFrameSource = new FrameSource(bgFf.stdout, bgFrameSize);
    }
  }

  // particles
  const particles = bg.particles ? Array.from({ length: 60 }, () => ({
    x: Math.random(), y: Math.random(), r: 1 + Math.random() * 2.4,
    vx: (Math.random() - 0.5) * 0.00012, vy: -0.00008 - Math.random() * 0.00018,
    a: 0.25 + Math.random() * 0.5,
  })) : [];

  // output ffmpeg: reads raw BGRA frames from stdin, encodes with chosen (GPU if available) encoder
  const outArgs = [
    "-y", "-f", "rawvideo", "-pix_fmt", "bgra", "-s", `${width}x${height}`,
    "-r", String(outFps), "-i", "-",
    ...encoderArgs,
    tmpVideoPath,
  ];
  const outFf = spawn(ffmpegPath, outArgs);
  let ffErr = "";
  outFf.stderr.on("data", (d) => { ffErr += d.toString(); });
  const outDone = new Promise((resolve, reject) => {
    outFf.on("close", (code) => (code === 0 ? resolve() : reject(new Error("encode failed: " + ffErr.slice(-2000)))));
  });

  const startTime = Date.now();
  let bgVideoCanvas = null;
  if (bgFrameSize) {
    bgVideoCanvas = createCanvas(width, height);
  }

  for (let i = 0; i < totalFrames; i++) {
    const t = i / fps;
    const fdata = framesData[Math.min(i, framesData.length - 1)] || { bars: new Float32Array(spectrum.bars), beatEnv: 0 };
    const beatValue = fdata.beatEnv || 0;

    ctx.clearRect(0, 0, width, height);

    let bgMedia = bgStaticImg;
    if (bgFrameSource) {
      // eslint-disable-next-line no-await-in-loop
      const raw = await bgFrameSource.next();
      if (raw) {
        const bctx = bgVideoCanvas.getContext("2d");
        const imgData = bctx.createImageData(width, height);
        imgData.data.set(raw);
        bctx.putImageData(imgData, 0, 0);
        bgMedia = bgVideoCanvas;
      }
    }

    draw.drawBackground(ctx, width, height, bg, t, beatValue, bgMedia);
    draw.applyColorGrade(ctx, width, height, bg.grade);
    if (bg.particles) { draw.stepParticles(particles, 1000 / fps); draw.drawParticles(ctx, width, height, particles); }
    if (bg.vignette) draw.drawVignette(ctx, width, height);

    draw.drawSpectrum(ctx, width, height, spectrum, fdata.bars);
    if (logoImg) draw.drawLogo(ctx, width, height, logo, logoImg, t, beatValue);
    draw.drawText(ctx, width, height, title, "title");
    draw.drawText(ctx, width, height, subtitle, "subtitle");

    const buf = canvas.toBuffer("raw"); // BGRA, matches -pix_fmt bgra above

    const ok = outFf.stdin.write(buf);
    if (!ok) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => outFf.stdin.once("drain", resolve));
    }

    if (i % 15 === 0 || i === totalFrames - 1) {
      const elapsedSec = (Date.now() - startTime) / 1000;
      const renderedSec = i / fps;
      const speedMultiplier = elapsedSec > 0 ? (renderedSec / elapsedSec) : 0;
      post({ type: "progress", frame: i, totalFrames, encoder, speedMultiplier });
    }
  }

  outFf.stdin.end();
  await outDone;
  post({ type: "video-encoded", tmpVideoPath });
}

run().catch((err) => post({ type: "error", message: err.message }));
