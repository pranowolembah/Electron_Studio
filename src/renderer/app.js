const { ipcRenderer } = require("electron");
const path = require("path");
const draw = require("../shared/drawing");
const C = require("../shared/constants");

/* ---------------- state ---------------- */
const state = {
  audioFiles: [], // {id, path, name, duration}
  order: "original",
  orderList: [],
  trackPos: 0,
  aspectRatio: "16:9",
  resolution: 1080,
  codec: "webm",
  fps: 30,
  outputPath: null,

  bg: { type: "cyberpunk", url: null, kind: null, anim: "none", particles: true, grade: "none", vignette: true },
  logo: { url: null, anim: "rotate", size: 0.14, x: 0.88, y: 0.14 },
  title: { text: "NAMA PLAYLIST KAMU", font: C.TITLE_FONTS[0].family, size: 64, align: "center", x: 0.5, y: 0.12, stroke: true, strokeColor: "#000000", shadow: true, shadowColor: "#000000", density: 2, color: "#ffffff" },
  subtitle: { text: "Artis - Judul Lagu\nBaris kedua...", font: C.SUBTITLE_FONTS[0].family, size: 28, align: "center", x: 0.5, y: 0.92, stroke: false, strokeColor: "#000000", shadow: true, shadowColor: "#000000", density: 0.5, color: "#e5e5e5" },
  spectrum: { style: 8, theme: "Neon", solid: "#7c5cff", sensitivity: 1.4, widthScale: 0.8, bars: 48, gap: 3, height: 0.18, x: 0.5, y: 0.65 },
};

let uidc = 0;
const uid = () => "f" + (++uidc);

/* ---------------- canvas + preview audio graph ---------------- */
const canvas = document.getElementById("previewCanvas");
const ctx = canvas.getContext("2d");
const audioEl = document.getElementById("audioEl");

const AudioCtx = window.AudioContext || window.webkitAudioContext;
const actx = new AudioCtx();
const analyser = actx.createAnalyser();
analyser.fftSize = 512;
analyser.smoothingTimeConstant = 0.78;
const freq = new Uint8Array(analyser.frequencyBinCount);
const srcNode = actx.createMediaElementSource(audioEl);
srcNode.connect(analyser);
analyser.connect(actx.destination);

const particles = Array.from({ length: 60 }, () => ({
  x: Math.random(), y: Math.random(), r: 1 + Math.random() * 2.4,
  vx: (Math.random() - 0.5) * 0.00012, vy: -0.00008 - Math.random() * 0.00018,
  a: 0.25 + Math.random() * 0.5,
}));

let bgImg = null, logoImg = null;
let bassAvg = 0, beatEnv = 0;
let dragging = null;
let lastTs = 0;
let boxes = {};

function loadImageEl(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = "file://" + url;
  });
}

function setBgMedia() {
  if (state.bg.type === "custom" && state.bg.kind === "image" && state.bg.url) {
    loadImageEl(state.bg.url).then((img) => (bgImg = img));
  } else if (state.bg.type === "custom" && state.bg.kind === "video" && state.bg.url) {
    const v = document.createElement("video");
    v.src = "file://" + state.bg.url; v.loop = true; v.muted = true; v.playsInline = true;
    v.play().catch(() => {});
    bgImg = v;
  } else { bgImg = null; }
}
function setLogoMedia() {
  if (state.logo.url) loadImageEl(state.logo.url).then((img) => (logoImg = img));
  else logoImg = null;
}

function resizeCanvas() {
  const [w, h] = C.RESOLUTIONS[state.aspectRatio][state.resolution];
  canvas.width = w; canvas.height = h;
  const scale = Math.min(1, 860 / w);
  canvas.style.width = w * scale + "px";
  canvas.style.height = h * scale + "px";
}

function frame(ts) {
  const dt = lastTs ? ts - lastTs : 16;
  lastTs = ts;
  const w = canvas.width, h = canvas.height;

  analyser.getByteFrequencyData(freq);
  let bass = 0;
  const bassBins = Math.max(1, Math.floor(freq.length * 0.12));
  for (let i = 0; i < bassBins; i++) bass += freq[i];
  bass = bass / bassBins / 255;
  bassAvg = bassAvg * 0.92 + bass * 0.08;
  const beat = bass > bassAvg * 1.35 && bass > 0.18;
  beatEnv = beat ? 1 : beatEnv * 0.88;

  ctx.clearRect(0, 0, w, h);
  draw.drawBackground(ctx, w, h, state.bg, ts / 1000, beatEnv, bgImg);
  draw.applyColorGrade(ctx, w, h, state.bg.grade);
  if (state.bg.particles) { draw.stepParticles(particles, dt); draw.drawParticles(ctx, w, h, particles); }
  if (state.bg.vignette) draw.drawVignette(ctx, w, h);

  const N = state.spectrum.bars;
  const bars = new Array(N).fill(0);
  const step = Math.floor(freq.length / N) || 1;
  for (let i = 0; i < N; i++) {
    let s = 0; for (let j = 0; j < step; j++) s += freq[i * step + j] || 0;
    bars[i] = Math.min(1, (s / step / 255) * state.spectrum.sensitivity);
  }
  draw.drawSpectrum(ctx, w, h, state.spectrum, bars);
  if (logoImg) draw.drawLogo(ctx, w, h, state.logo, logoImg, ts / 1000, beatEnv);
  draw.drawText(ctx, w, h, state.title, "title");
  draw.drawText(ctx, w, h, state.subtitle, "subtitle");

  computeBoxes(w, h);
  if (!dragging) drawHandles(w, h);

  requestAnimationFrame(frame);
}

function computeBoxes(w, h) {
  boxes = {};
  if (logoImg) {
    const size = state.logo.size * Math.min(w, h);
    const ratio = (logoImg.naturalHeight || logoImg.height || 1) / (logoImg.naturalWidth || logoImg.width || 1);
    const dw = size, dh = size * ratio;
    const cx = state.logo.x * w, cy = state.logo.y * h;
    boxes.logo = { x0: (cx - dw / 2) / w, x1: (cx + dw / 2) / w, y0: (cy - dh / 2) / h, y1: (cy + dh / 2) / h };
  }
  ["title", "subtitle"].forEach((k) => {
    const cfg = state[k];
    const sizePx = Math.max(10, (cfg.size / 1080) * h);
    ctx.font = `700 ${sizePx}px "${cfg.font}"`;
    const lines = cfg.text.split("\n");
    let maxW = 0; lines.forEach((l) => { const mw = ctx.measureText(l).width; if (mw > maxW) maxW = mw; });
    const lineH = sizePx * 1.25, totalH = lineH * lines.length;
    const cx = cfg.x * w, cy = cfg.y * h;
    let x0, x1;
    if (cfg.align === "left") { x0 = cx; x1 = cx + maxW; }
    else if (cfg.align === "right") { x0 = cx - maxW; x1 = cx; }
    else { x0 = cx - maxW / 2; x1 = cx + maxW / 2; }
    boxes[k] = { x0: x0 / w, x1: x1 / w, y0: (cy - totalH / 2) / h, y1: (cy + totalH / 2) / h };
  });
  const sp = state.spectrum;
  const totalW = w * sp.widthScale, baseH = h * sp.height;
  const cx = sp.x * w, cy = sp.y * h;
  boxes.spectrum = { x0: (cx - totalW / 2) / w, x1: (cx + totalW / 2) / w, y0: (cy - baseH) / h, y1: cy / h };
}

function drawHandles(w, h) {
  Object.values(boxes).forEach((b) => {
    if (!b) return;
    ctx.save();
    ctx.strokeStyle = "rgba(200,255,77,0.85)";
    ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5;
    ctx.strokeRect(b.x0 * w - 6, b.y0 * h - 6, (b.x1 - b.x0) * w + 12, (b.y1 - b.y0) * h + 12);
    ctx.restore();
  });
}

canvas.addEventListener("mousedown", (e) => {
  const rect = canvas.getBoundingClientRect();
  const nx = (e.clientX - rect.left) / rect.width, ny = (e.clientY - rect.top) / rect.height;
  for (const key of ["logo", "title", "subtitle", "spectrum"]) {
    const b = boxes[key];
    if (b && nx >= b.x0 && nx <= b.x1 && ny >= b.y0 && ny <= b.y1) { dragging = key; return; }
  }
});
window.addEventListener("mousemove", (e) => {
  if (!dragging) return;
  const rect = canvas.getBoundingClientRect();
  let nx = (e.clientX - rect.left) / rect.width, ny = (e.clientY - rect.top) / rect.height;
  nx = Math.min(1, Math.max(0, nx)); ny = Math.min(1, Math.max(0, ny));
  if (Math.abs(nx - 0.5) < 0.018) nx = 0.5;
  if (Math.abs(ny - 0.5) < 0.018) ny = 0.5;
  if (dragging === "logo") { state.logo.x = nx; state.logo.y = ny; }
  if (dragging === "title") { state.title.x = nx; state.title.y = ny; }
  if (dragging === "subtitle") { state.subtitle.x = nx; state.subtitle.y = ny; }
  if (dragging === "spectrum") { state.spectrum.x = nx; state.spectrum.y = ny; }
});
window.addEventListener("mouseup", () => (dragging = null));

/* ---------------- playlist / playback ---------------- */
function rebuildOrder() {
  let idx = state.audioFiles.map((_, i) => i);
  if (state.order === "shuffle") {
    for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  }
  state.orderList = idx; state.trackPos = 0;
  renderPlaylistList();
}
function loadTrack(pos, autoplay) {
  if (!state.orderList.length) return;
  const f = state.audioFiles[state.orderList[pos % state.orderList.length]];
  if (!f) return;
  audioEl.src = "file://" + f.path;
  audioEl.currentTime = 0;
  if (autoplay) audioEl.play().catch(() => {});
}
document.getElementById("playBtn").onclick = () => {
  if (!state.audioFiles.length) return;
  if (actx.state === "suspended") actx.resume();
  if (!audioEl.src) { loadTrack(0, true); return; }
  if (audioEl.paused) audioEl.play(); else audioEl.pause();
};
document.getElementById("nextBtn").onclick = () => { state.trackPos = (state.trackPos + 1) % Math.max(state.orderList.length, 1); loadTrack(state.trackPos, true); };
document.getElementById("prevBtn").onclick = () => { state.trackPos = (state.trackPos - 1 + state.orderList.length) % Math.max(state.orderList.length, 1); loadTrack(state.trackPos, true); };
audioEl.addEventListener("ended", () => document.getElementById("nextBtn").onclick());

/* ---------------- generic UI builders ---------------- */
function el(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  });
  children.forEach((c) => e.appendChild(typeof c === "string" ? document.createTextNode(c) : c));
  return e;
}
function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  setTimeout(() => (t.textContent = ""), 2500);
}

function renderPlaylistList() {
  const box = document.getElementById("playlistList");
  if (!box) return;
  box.innerHTML = "";
  if (!state.audioFiles.length) { box.appendChild(el("div", { class: "note" }, ["Belum ada audio diupload."])); return; }
  state.orderList.forEach((fileIdx, pos) => {
    const f = state.audioFiles[fileIdx];
    const item = el("div", { class: "list-item" + (pos === state.trackPos ? " active" : "") }, [
      el("span", {}, [String(pos + 1)]),
      el("span", { class: "name" }, [f.name]),
      el("span", { class: "dur" }, [f.duration ? fmtDur(f.duration) : "--:--"]),
      el("span", { class: "del", onclick: () => { state.audioFiles = state.audioFiles.filter((x) => x.id !== f.id); rebuildOrder(); } }, ["🗑"]),
    ]);
    box.appendChild(item);
  });
}
function fmtDur(s) { const m = Math.floor(s / 60), ss = Math.floor(s % 60); return `${m}:${String(ss).padStart(2, "0")}`; }

/* ---------------- panels ---------------- */
const panelsRoot = document.getElementById("panels");
const panelDefs = {
  playlist: buildPlaylistPanel,
  background: buildBackgroundPanel,
  logo: buildLogoPanel,
  title: () => buildTextPanel("title"),
  subtitle: () => buildTextPanel("subtitle"),
  spectrum: buildSpectrumPanel,
  output: buildOutputPanel,
};
Object.keys(panelDefs).forEach((key) => {
  const p = el("div", { class: "panel" + (key === "playlist" ? " active" : ""), id: "panel-" + key });
  panelsRoot.appendChild(p);
});
function refreshPanel(key) {
  const p = document.getElementById("panel-" + key);
  p.innerHTML = "";
  panelDefs[key](p);
}
Object.keys(panelDefs).forEach(refreshPanel);

document.querySelectorAll(".tab").forEach((btn) => {
  btn.onclick = () => {
    document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("panel-" + btn.dataset.tab).classList.add("active");
  };
});

function buildPlaylistPanel(p) {
  p.appendChild(el("div", { class: "upload", onclick: async () => {
    const files = await ipcRenderer.invoke("pick-audio-files");
    files.forEach((fp) => state.audioFiles.push({ id: uid(), path: fp, name: path.basename(fp), duration: 0 }));
    rebuildOrder();
    files.forEach((fp) => {
      const probe = new Audio("file://" + fp);
      probe.addEventListener("loadedmetadata", () => {
        const f = state.audioFiles.find((x) => x.path === fp);
        if (f) { f.duration = probe.duration; renderPlaylistList(); }
      });
    });
  } }, ["⬆ Upload audio (bisa banyak file)"]));

  const orderRow = el("div", { class: "row" }, [
    el("button", { class: "btn" + (state.order === "original" ? " active" : ""), onclick: () => { state.order = "original"; rebuildOrder(); refreshPanel("playlist"); } }, ["Urutan Asli"]),
    el("button", { class: "btn" + (state.order === "shuffle" ? " active" : ""), onclick: () => { state.order = "shuffle"; rebuildOrder(); refreshPanel("playlist"); } }, ["Acak"]),
  ]);
  p.appendChild(orderRow);
  p.appendChild(el("div", { id: "playlistList" }));
  renderPlaylistList();
}

function buildBackgroundPanel(p) {
  const types = [["cyberpunk", "Cyberpunk"], ["greenscreen", "Green Screen"], ["transparent", "Transparan"], ["custom", "Custom Upload"]];
  p.appendChild(el("div", { class: "field-label" }, ["Jenis latar"]));
  p.appendChild(el("div", { class: "row" }, types.map(([k, l]) =>
    el("button", { class: "btn" + (state.bg.type === k ? " active" : ""), onclick: () => { state.bg.type = k; refreshPanel("background"); } }, [l]))));

  if (state.bg.type === "custom") {
    p.appendChild(el("div", { class: "upload", onclick: async () => {
      const res = await ipcRenderer.invoke("pick-image-or-video");
      if (res) { state.bg.url = res.path; state.bg.kind = res.kind; setBgMedia(); }
    } }, ["⬆ Upload gambar / video latar"]));
  }
  if (state.bg.type === "transparent") {
    p.appendChild(el("div", { class: "note" }, ["Preview pakai pola kotak-kotak. Untuk hasil akhir yang bisa di-chroma-key, gunakan Green Screen."]));
  }

  p.appendChild(el("div", { class: "field-label" }, ["Animasi latar"]));
  p.appendChild(el("div", { class: "row" }, [
    el("button", { class: "btn" + (state.bg.anim === "none" ? " active" : ""), onclick: () => { state.bg.anim = "none"; refreshPanel("background"); } }, ["Tanpa Animasi"]),
    el("button", { class: "btn" + (state.bg.anim === "beat" ? " active" : ""), onclick: () => { state.bg.anim = "beat"; refreshPanel("background"); } }, ["Denyut Sesuai Beat"]),
  ]));

  p.appendChild(el("label", { class: "checkrow" }, ["Partikel bergerak lembut", checkbox(state.bg.particles, (v) => (state.bg.particles = v))]));
  p.appendChild(el("label", { class: "checkrow" }, ["Vignette halus", checkbox(state.bg.vignette, (v) => (state.bg.vignette = v))]));

  p.appendChild(el("div", { class: "field-label" }, ["Color grading"]));
  p.appendChild(el("div", { class: "row" }, C.GRADES.map((g) =>
    el("button", { class: "btn" + (state.bg.grade === g ? " active" : ""), onclick: () => { state.bg.grade = g; refreshPanel("background"); } }, [g === "none" ? "Asli" : g]))));
}

function buildLogoPanel(p) {
  p.appendChild(el("div", { class: "upload", onclick: async () => {
    const fp = await ipcRenderer.invoke("pick-image");
    if (fp) { state.logo.url = fp; setLogoMedia(); }
  } }, ["⬆ Upload logo (PNG transparan disarankan)"]));

  const anims = [["none", "Tanpa animasi"], ["rotate", "Memutar lembut/pelan"], ["blink", "Berkelip lembut"], ["beat", "Denyut sesuai beat"]];
  p.appendChild(el("div", { class: "field-label" }, ["Animasi logo"]));
  anims.forEach(([k, l]) => p.appendChild(el("button", { class: "btn btn-wide" + (state.logo.anim === k ? " active" : ""), onclick: () => { state.logo.anim = k; refreshPanel("logo"); } }, [l])));

  p.appendChild(rangeField("Ukuran logo", state.logo.size, 0.04, 0.4, 0.01, (v) => (state.logo.size = v), (v) => Math.round(v * 100) + "%"));
  p.appendChild(el("div", { class: "note" }, ["Drag logo di preview untuk atur posisi."]));
}

function buildTextPanel(kind) {
  return (p) => {
    const cfg = state[kind];
    const fonts = kind === "title" ? C.TITLE_FONTS : C.SUBTITLE_FONTS;
    if (kind === "title") {
      p.appendChild(el("input", { type: "text", value: cfg.text, oninput: (e) => (cfg.text = e.target.value) }));
    } else {
      const ta = el("textarea", { rows: 3, oninput: (e) => (cfg.text = e.target.value) });
      ta.value = cfg.text; p.appendChild(ta);
    }
    p.appendChild(el("div", { class: "field-label" }, ["Font"]));
    const sel = el("select", { onchange: (e) => (cfg.font = e.target.value) }, fonts.map((f) => {
      const o = el("option", { value: f.family }, [f.family]);
      if (f.family === cfg.font) o.selected = true;
      return o;
    }));
    p.appendChild(sel);

    p.appendChild(rangeField("Ukuran", cfg.size, 12, 160, 1, (v) => (cfg.size = v)));
    p.appendChild(rangeField("Density (spasi huruf)", cfg.density, -2, 20, 1, (v) => (cfg.density = v)));

    p.appendChild(el("div", { class: "field-label" }, ["Perataan teks"]));
    p.appendChild(el("div", { class: "row" }, ["left", "center", "right"].map((a) =>
      el("button", { class: "btn" + (cfg.align === a ? " active" : ""), onclick: () => { cfg.align = a; refreshPanel(kind); } }, [a]))));

    p.appendChild(el("div", { class: "field-label" }, ["Posisi cepat"]));
    p.appendChild(el("div", { class: "row" }, C.RESOLUTIONS ? buildPositionButtons(cfg) : []));

    p.appendChild(el("label", { class: "checkrow" }, ["Garis tepi", checkbox(cfg.stroke, (v) => (cfg.stroke = v))]));
    p.appendChild(el("label", { class: "checkrow" }, ["Bayangan", checkbox(cfg.shadow, (v) => (cfg.shadow = v))]));
    p.appendChild(el("div", { class: "colorpair" }, ["Warna teks", colorInput(cfg.color, (v) => (cfg.color = v))]));
    p.appendChild(el("div", { class: "colorpair" }, ["Warna tepi", colorInput(cfg.strokeColor, (v) => (cfg.strokeColor = v))]));
    p.appendChild(el("div", { class: "note" }, ["Drag teks di preview untuk atur posisi."]));
  };
}
function buildPositionButtons(cfg) {
  const POSITIONS = [["Kiri Atas", 0.12, 0.12], ["Tengah Atas", 0.5, 0.1], ["Kanan Atas", 0.88, 0.12],
    ["Kiri Tengah", 0.12, 0.5], ["Tengah", 0.5, 0.5], ["Kanan Tengah", 0.88, 0.5],
    ["Kiri Bawah", 0.12, 0.88], ["Tengah Bawah", 0.5, 0.9], ["Kanan Bawah", 0.88, 0.88]];
  return POSITIONS.map(([label, x, y]) => el("button", { class: "btn", onclick: () => { cfg.x = x; cfg.y = y; } }, [label]));
}

function buildSpectrumPanel(p) {
  const sp = state.spectrum;
  p.appendChild(el("div", { class: "field-label" }, ["Jenis spektrum"]));
  p.appendChild(el("div", { class: "row" }, C.SPECTRUM_STYLES.map((s, i) =>
    el("button", { class: "btn" + (sp.style === i ? " active" : ""), onclick: () => { sp.style = i; refreshPanel("spectrum"); } }, [s]))));

  p.appendChild(el("div", { class: "field-label" }, ["Tema warna"]));
  p.appendChild(el("div", { class: "row" }, C.COLOR_THEMES.map((t) =>
    el("button", { class: "btn" + (sp.theme === t ? " active" : ""), onclick: () => { sp.theme = t; refreshPanel("spectrum"); } }, [t]))));
  if (sp.theme === "Solid") p.appendChild(el("div", { class: "colorpair" }, ["Warna", colorInput(sp.solid, (v) => (sp.solid = v))]));

  p.appendChild(rangeField("Sensitivitas", sp.sensitivity, 0.4, 3, 0.1, (v) => (sp.sensitivity = v)));
  p.appendChild(rangeField("Skala lebar", sp.widthScale, 0.2, 1, 0.02, (v) => (sp.widthScale = v), (v) => Math.round(v * 100) + "%"));
  p.appendChild(rangeField("Jumlah bar", sp.bars, 8, 128, 2, (v) => (sp.bars = v)));
  p.appendChild(rangeField("Gap antar bar", sp.gap, 0, 14, 1, (v) => (sp.gap = v)));
  p.appendChild(rangeField("Tinggi spektrum", sp.height, 0.05, 0.5, 0.01, (v) => (sp.height = v), (v) => Math.round(v * 100) + "%"));
  p.appendChild(el("div", { class: "note" }, ["Drag area spektrum di preview untuk reposisi."]));
}

function buildOutputPanel(p) {
  p.appendChild(el("div", { class: "field-label" }, ["Rasio aspek"]));
  p.appendChild(el("div", { class: "row" }, ["16:9", "9:16", "1:1"].map((r) =>
    el("button", { class: "btn" + (state.aspectRatio === r ? " active" : ""), onclick: () => { state.aspectRatio = r; resizeCanvas(); refreshPanel("output"); } }, [r]))));

  p.appendChild(el("div", { class: "field-label" }, ["Resolusi"]));
  p.appendChild(el("div", { class: "row" }, [1080, 1440, 2160].map((r) =>
    el("button", { class: "btn" + (state.resolution === r ? " active" : ""), onclick: () => { state.resolution = r; resizeCanvas(); refreshPanel("output"); } }, [r === 2160 ? "4K" : r + "p"]))));

  p.appendChild(el("div", { class: "field-label" }, ["Codec"]));
  p.appendChild(el("div", { class: "row" }, [["webm", "WebM (VP9)"], ["h264", "H.264 (mp4)"], ["hevc", "HEVC (mp4)"]].map(([k, l]) =>
    el("button", { class: "btn" + (state.codec === k ? " active" : ""), onclick: () => { state.codec = k; refreshPanel("output"); } }, [l]))));
  p.appendChild(el("div", { class: "note" }, ["Aplikasi otomatis memilih encoder GPU (NVENC/QSV/AMF) jika tersedia, fallback ke CPU (libx264/libx265/libvpx) bila tidak."]));

  p.appendChild(el("div", { class: "field-label" }, ["FPS"]));
  p.appendChild(el("div", { class: "row" }, [24, 30, 60].map((f) =>
    el("button", { class: "btn" + (state.fps === f ? " active" : ""), onclick: () => { state.fps = f; refreshPanel("output"); } }, [String(f)]))));
}

function checkbox(checked, onChange) {
  const c = el("input", { type: "checkbox" });
  c.checked = checked; c.onchange = (e) => onChange(e.target.checked);
  return c;
}
function colorInput(value, onChange) {
  const c = el("input", { type: "color" });
  c.value = value; c.oninput = (e) => onChange(e.target.value);
  return c;
}
function rangeField(label, value, min, max, step, onChange, fmt) {
  const wrap = el("div", {});
  const top = el("div", { class: "minirange" }, [label, fmt ? fmt(value) : String(value)]);
  const r = el("input", { type: "range", min, max, step });
  r.value = value;
  r.oninput = (e) => { const v = parseFloat(e.target.value); onChange(v); top.lastChild.textContent = fmt ? fmt(v) : String(v); };
  wrap.appendChild(top); wrap.appendChild(r);
  return wrap;
}

/* ---------------- render trigger ---------------- */
const renderBtn = document.getElementById("renderBtn");
const stageBox = document.getElementById("stageBox");
const stageLabel = document.getElementById("stageLabel");
const progressFill = document.getElementById("progressFill");
const speedLabel = document.getElementById("speedLabel");
const doneBox = document.getElementById("doneBox");

renderBtn.onclick = async () => {
  if (!state.audioFiles.length) { toast("Upload minimal 1 file audio dulu."); return; }
  const ext = state.codec === "webm" ? "webm" : "mp4";
  const outPath = await ipcRenderer.invoke("pick-output-path", ext);
  if (!outPath) return;
  state.outputPath = outPath;

  audioEl.pause();
  doneBox.classList.add("hidden");
  stageBox.classList.remove("hidden");
  progressFill.style.width = "0%";
  renderBtn.disabled = true;

  const tracks = state.orderList.map((idx) => {
    const f = state.audioFiles[idx];
    return { path: f.path, duration: f.duration };
  });

  const config = {
    tracks, aspectRatio: state.aspectRatio, resolution: state.resolution, codec: state.codec, fps: state.fps,
    bg: state.bg, logo: state.logo, title: state.title, subtitle: state.subtitle, spectrum: state.spectrum,
    outputPath: outPath,
  };
  ipcRenderer.invoke("start-render", config);
};

ipcRenderer.on("render-stage", (_e, data) => { stageLabel.textContent = data.label; });
ipcRenderer.on("render-progress", (_e, data) => {
  progressFill.style.width = data.percent.toFixed(1) + "%";
  stageLabel.textContent = `Merender frame... (${data.encoder})`;
  speedLabel.textContent = data.speedMultiplier ? `Kecepatan render: ${data.speedMultiplier.toFixed(1)}x dari real-time` : "";
});
ipcRenderer.on("render-done", (_e, data) => {
  renderBtn.disabled = false;
  stageBox.classList.add("hidden");
  doneBox.classList.remove("hidden");
  doneBox.innerHTML = "";
  doneBox.appendChild(el("div", {}, [`Selesai · ${data.sizeMB} MB · encoder ${data.encoder}${data.hardware ? " (GPU)" : " (CPU)"}`]));
  doneBox.appendChild(el("span", { class: "openfolder", onclick: () => require("electron").shell.showItemInFolder(data.outputPath) }, ["Buka folder"]));
});
ipcRenderer.on("render-error", (_e, data) => {
  renderBtn.disabled = false;
  stageBox.classList.add("hidden");
  toast("Gagal render: " + data.message);
});

/* ---------------- init ---------------- */
resizeCanvas();
requestAnimationFrame(frame);
