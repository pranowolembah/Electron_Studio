// Pure Canvas2D drawing functions. Works unmodified in:
//  - browser (renderer process, live preview)
//  - node-canvas (worker thread, turbo offline render)
// No Node-only or DOM-only APIs are used here. `ctx` must be a CanvasRenderingContext2D
// (browser) or node-canvas Context2d. `bgMedia`/`logoImg` must be anything drawImage-compatible
// (HTMLImageElement/HTMLVideoElement/HTMLCanvasElement in browser, Image/Canvas in node-canvas).

const { SPECTRUM_STYLES } = require("./constants");

function themeColor(theme, t, solid) {
  if (theme === "Solid") return solid;
  if (theme === "Neon") return ["#00f0ff", "#ff00e6", "#7c5cff"][Math.floor(t * 3) % 3];
  if (theme === "Matrix") return `rgba(${20 + t * 10},${220 + t * 30},90,1)`;
  if (theme === "Purple Glow") return `hsl(${265 + t * 20},85%,${55 + t * 15}%)`;
  return `hsl(${Math.floor(t * 360)},90%,60%)`; // Pelangi
}

function applyColorGrade(ctx, w, h, grade) {
  // node-canvas (cairo) does not support ctx.filter, so grading is done via
  // a composited overlay instead -- works identically in both environments.
  const overlays = {
    warm: ["rgba(255,150,60,0.10)", "multiply"],
    cool: ["rgba(60,140,255,0.10)", "multiply"],
    vintage: ["rgba(120,90,60,0.22)", "multiply"],
    vibrant: ["rgba(255,255,255,0.06)", "overlay"],
  };
  const cfg = overlays[grade];
  if (!cfg) return;
  ctx.save();
  ctx.globalCompositeOperation = cfg[1];
  ctx.fillStyle = cfg[0];
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

function drawBackground(ctx, w, h, bg, t, beatValue, bgMedia) {
  ctx.save();
  const scale = bg.anim === "beat" ? 1 + beatValue * 0.035 : 1;
  ctx.translate(w / 2, h / 2);
  ctx.scale(scale, scale);
  ctx.translate(-w / 2, -h / 2);

  if (bg.type === "cyberpunk") {
    const hueShift = (t * 600) % 360;
    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, `hsl(${260 + Math.sin(t * 0.3) * 20},70%,12%)`);
    grad.addColorStop(0.5, `hsl(${300 + hueShift * 0.05},70%,18%)`);
    grad.addColorStop(1, `hsl(${190 + hueShift * 0.05},80%,14%)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(124,92,255,0.18)";
    ctx.lineWidth = Math.max(1, w * 0.0008);
    const grid = 14;
    const off = (t * 60) % (h / grid);
    for (let i = -1; i <= grid; i++) {
      const y = i * (h / grid) + off;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    for (let i = 0; i <= grid; i++) {
      const x = i * (w / grid);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
  } else if (bg.type === "greenscreen") {
    ctx.fillStyle = "#00ff3c";
    ctx.fillRect(0, 0, w, h);
  } else if (bg.type === "transparent") {
    const sz = Math.max(16, w * 0.025);
    for (let y = 0; y < h; y += sz) {
      for (let x = 0; x < w; x += sz) {
        ctx.fillStyle = ((x / sz + y / sz) % 2 === 0) ? "#3a3a3a" : "#2a2a2a";
        ctx.fillRect(x, y, sz, sz);
      }
    }
  } else if (bg.type === "custom") {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);
    if (bgMedia && bgMedia.width) {
      const mw = bgMedia.width, mh = bgMedia.height;
      const sc = Math.max(w / mw, h / mh);
      const dw = mw * sc, dh = mh * sc;
      ctx.drawImage(bgMedia, (w - dw) / 2, (h - dh) / 2, dw, dh);
    }
  }
  ctx.restore();
}

function drawParticles(ctx, w, h, particles) {
  for (const p of particles) {
    ctx.save();
    ctx.globalAlpha = p.a;
    ctx.shadowBlur = p.r * 4;
    ctx.shadowColor = "rgba(255,255,255,0.8)";
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(p.x * w, p.y * h, p.r * (w / 1000), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function stepParticles(particles, dtMs) {
  for (const p of particles) {
    p.x += p.vx * dtMs; p.y += p.vy * dtMs;
    if (p.y < -0.02) { p.y = 1.02; p.x = Math.random(); }
    if (p.x < -0.02) p.x = 1.02;
    if (p.x > 1.02) p.x = -0.02;
  }
}

function drawVignette(ctx, w, h) {
  const vg = ctx.createRadialGradient(w / 2, h / 2, h * 0.25, w / 2, h / 2, h * 0.75);
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(0,0,0,0.45)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, w, h);
}

// data: array (len = cfg.bars) of 0..1 amplitudes, already precomputed for this frame.
function drawSpectrum(ctx, w, h, cfg, data) {
  const N = cfg.bars;
  const totalW = w * cfg.widthScale;
  const cx = cfg.x * w, cy = cfg.y * h;
  const baseH = h * cfg.height;
  const styleName = SPECTRUM_STYLES[cfg.style];
  ctx.save();

  if (styleName === "Waveform Line" || styleName === "Wave Halus") {
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      const x = cx - totalW / 2 + (i / (N - 1)) * totalW;
      const y = cy - data[i] * baseH;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.lineWidth = Math.max(2, w * 0.003);
    ctx.strokeStyle = themeColor(cfg.theme, 0.5, cfg.solid);
    ctx.shadowBlur = 14; ctx.shadowColor = themeColor(cfg.theme, 0.5, cfg.solid);
    ctx.stroke();
    ctx.restore(); return;
  }

  if (styleName === "Radial Circular") {
    const R = baseH;
    for (let i = 0; i < N; i++) {
      const ang = (i / N) * Math.PI * 2;
      const len = R * 0.4 + data[i] * R;
      const x1 = cx + Math.cos(ang) * R * 0.4, y1 = cy + Math.sin(ang) * R * 0.4;
      const x2 = cx + Math.cos(ang) * len, y2 = cy + Math.sin(ang) * len;
      ctx.strokeStyle = themeColor(cfg.theme, i / N, cfg.solid);
      ctx.lineWidth = Math.max(2, (totalW / N) * 0.6);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    ctx.restore(); return;
  }

  if (styleName === "Dot Matrix") {
    const cols = N, rows = 6;
    const cellW = totalW / cols;
    for (let i = 0; i < cols; i++) {
      const lit = Math.round(data[i] * rows);
      for (let r = 0; r < rows; r++) {
        const x = cx - totalW / 2 + i * cellW + cellW / 2;
        const y = cy - r * (baseH / rows);
        ctx.globalAlpha = r < lit ? 1 : 0.12;
        ctx.fillStyle = themeColor(cfg.theme, i / cols, cfg.solid);
        ctx.beginPath(); ctx.arc(x, y, cellW * 0.28, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore(); return;
  }

  const barW = Math.max(1, (totalW / N) - cfg.gap);
  for (let i = 0; i < N; i++) {
    const amp = data[i];
    const color = themeColor(cfg.theme, i / N, cfg.solid);
    ctx.fillStyle = color;
    ctx.shadowBlur = styleName === "Neon Glow Bar" ? 18 : 0;
    ctx.shadowColor = color;

    if (styleName === "Bar Horizontal") {
      const x = cx - totalW / 2;
      const barH = Math.max(1, (baseH * 1.6 / N) - cfg.gap);
      const y = cy - baseH * 1.6 / 2 + i * (barH + cfg.gap);
      ctx.fillRect(x, y, amp * totalW, barH);
    } else if (styleName === "Mirror Bar") {
      const x = cx - totalW / 2 + i * (barW + cfg.gap);
      const bh = amp * baseH;
      ctx.fillRect(x, cy - bh, barW, bh * 2);
    } else if (styleName === "Symmetric Center") {
      const half = N / 2;
      const idx = i < half ? half - 1 - i : i - half;
      const xL = cx - (idx + 1) * (barW + cfg.gap);
      const xR = cx + idx * (barW + cfg.gap);
      const bh = amp * baseH;
      ctx.fillRect(xL, cy - bh, barW, bh);
      ctx.fillRect(xR, cy - bh, barW, bh);
    } else if (styleName === "Block Pulse") {
      const x = cx - totalW / 2 + i * (barW + cfg.gap);
      const bh = Math.max(barW, amp * baseH);
      ctx.fillRect(x, cy - bh, barW, bh);
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.strokeRect(x, cy - bh, barW, bh);
    } else {
      const x = cx - totalW / 2 + i * (barW + cfg.gap);
      const bh = amp * baseH;
      ctx.fillRect(x, cy - bh, barW, bh);
    }
  }
  ctx.restore();
}

function drawLogo(ctx, w, h, logo, logoImg, t, beatValue) {
  if (!logoImg || !logoImg.width) return;
  const size = logo.size * Math.min(w, h);
  const ratio = logoImg.height / logoImg.width || 1;
  const dw = size, dh = size * ratio;
  const cx = logo.x * w, cy = logo.y * h;

  ctx.save();
  ctx.translate(cx, cy);
  let scale = 1, opacity = 1;
  if (logo.anim === "rotate") ctx.rotate(t * 0.4);
  if (logo.anim === "blink") opacity = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(t * 2.2));
  if (logo.anim === "beat") scale = 1 + beatValue * 0.18;
  ctx.scale(scale, scale);
  ctx.globalAlpha = opacity;
  ctx.drawImage(logoImg, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();
}

function drawText(ctx, w, h, cfg, kind) {
  if (!cfg.text) return;
  const sizePx = Math.max(10, (cfg.size / 1080) * h);
  ctx.save();
  ctx.font = `${kind === "title" ? 700 : 500} ${sizePx}px "${cfg.font}"`;
  ctx.textAlign = cfg.align;
  ctx.textBaseline = "middle";
  if (ctx.letterSpacing !== undefined) ctx.letterSpacing = `${cfg.density}px`;

  const lines = cfg.text.split("\n");
  const lineH = sizePx * 1.25;
  const totalH = lineH * lines.length;
  const cx = cfg.x * w, cy = cfg.y * h;

  if (cfg.shadow) {
    ctx.shadowColor = cfg.shadowColor;
    ctx.shadowBlur = sizePx * 0.25;
    ctx.shadowOffsetY = sizePx * 0.04;
  }

  lines.forEach((line, i) => {
    const ly = cy - totalH / 2 + lineH * i + lineH / 2;
    if (cfg.stroke) {
      ctx.lineWidth = sizePx * 0.06;
      ctx.strokeStyle = cfg.strokeColor;
      ctx.strokeText(line, cx, ly);
    }
    ctx.fillStyle = cfg.color;
    ctx.fillText(line, cx, ly);
  });
  ctx.restore();
}

module.exports = {
  themeColor, applyColorGrade, drawBackground, drawParticles, stepParticles,
  drawVignette, drawSpectrum, drawLogo, drawText,
};
