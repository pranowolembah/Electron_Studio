const { spawn } = require("child_process");
const FFT = require("fft.js");
const { getFfmpegPath } = require("./ffmpegUtil");

const SAMPLE_RATE = 44100;
const FFT_SIZE = 2048; // power of 2, gives decent frequency resolution

function decodeToPCM(filePath) {
  // Decode any input audio to mono 16-bit PCM at SAMPLE_RATE, fully offline (no playback).
  return new Promise((resolve, reject) => {
    const ff = spawn(getFfmpegPath(), [
      "-i", filePath, "-f", "s16le", "-ac", "1", "-ar", String(SAMPLE_RATE), "-",
    ]);
    const chunks = [];
    ff.stdout.on("data", (d) => chunks.push(d));
    let err = "";
    ff.stderr.on("data", (d) => (err += d.toString()));
    ff.on("close", (code) => {
      if (code !== 0 && chunks.length === 0) return reject(new Error("ffmpeg decode failed: " + err));
      const buf = Buffer.concat(chunks);
      const samples = new Float32Array(buf.length / 2);
      for (let i = 0; i < samples.length; i++) {
        samples[i] = buf.readInt16LE(i * 2) / 32768;
      }
      resolve(samples);
    });
    ff.on("error", reject);
  });
}

function hannWindow(n) {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  return w;
}

// Builds, for ONE audio track, an array of length `numFrames` where each entry is
// { bars: Float32Array(barsCount) in 0..1, bass: number in 0..1 }
// sampled at `fps`, fully precomputed -- no relation to real-time playback speed.
function analyzeTrack(samples, durationSec, fps, barsCount) {
  const fft = new FFT(FFT_SIZE);
  const window = hannWindow(FFT_SIZE);
  const out = fft.createComplexArray();
  const inputBuf = new Float64Array(FFT_SIZE);

  const numFrames = Math.max(1, Math.round(durationSec * fps));
  const frames = new Array(numFrames);
  let bassRunningAvg = 0;

  for (let f = 0; f < numFrames; f++) {
    const centerSample = Math.floor((f / fps) * SAMPLE_RATE);
    const start = Math.max(0, centerSample - FFT_SIZE / 2);
    for (let i = 0; i < FFT_SIZE; i++) {
      const s = samples[start + i] || 0;
      inputBuf[i] = s * window[i];
    }
    fft.realTransform(out, inputBuf);
    fft.completeSpectrum(out);

    const bins = FFT_SIZE / 2;
    const mags = new Float32Array(bins);
    let maxMag = 1e-6;
    for (let i = 0; i < bins; i++) {
      const re = out[i * 2], im = out[i * 2 + 1];
      const m = Math.sqrt(re * re + im * im);
      mags[i] = m;
      if (m > maxMag) maxMag = m;
    }

    // bucket into barsCount log-ish groups
    const bars = new Float32Array(barsCount);
    const step = Math.max(1, Math.floor(bins / barsCount));
    for (let b = 0; b < barsCount; b++) {
      let sum = 0, cnt = 0;
      for (let i = b * step; i < Math.min(bins, (b + 1) * step); i++) { sum += mags[i]; cnt++; }
      bars[b] = cnt ? Math.min(1, (sum / cnt / maxMag)) : 0;
    }

    // bass energy = average magnitude of lowest ~12% bins, normalized
    const bassBins = Math.max(1, Math.floor(bins * 0.12));
    let bsum = 0;
    for (let i = 0; i < bassBins; i++) bsum += mags[i];
    const bass = Math.min(1, bsum / bassBins / maxMag);
    bassRunningAvg = bassRunningAvg * 0.92 + bass * 0.08;
    const beat = (bass > bassRunningAvg * 1.35 && bass > 0.18) ? 1 : 0;

    frames[f] = { bars, bass, beat };
  }

  // smooth the beat impulses into a decaying envelope, same shape the live web version uses
  let env = 0;
  for (let f = 0; f < frames.length; f++) {
    env = frames[f].beat ? 1 : env * 0.88;
    frames[f].beatEnv = env;
  }

  return frames;
}

async function analyzePlaylist(tracks, fps, barsCount, onProgress) {
  // tracks: [{ path, duration }] in render order
  const allFrames = [];
  for (let i = 0; i < tracks.length; i++) {
    const samples = await decodeToPCM(tracks[i].path);
    const frames = analyzeTrack(samples, tracks[i].duration, fps, barsCount);
    allFrames.push(...frames);
    if (onProgress) onProgress({ stage: "analyze", trackIndex: i, of: tracks.length });
  }
  return allFrames; // one continuous timeline, index = absolute frame number
}

module.exports = { analyzePlaylist, decodeToPCM, analyzeTrack, SAMPLE_RATE };
