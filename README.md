# Music Render Studio (Desktop / Windows Installer)

Renderer video playlist musik versi desktop. Berbeda dari versi web sebelumnya,
render di sini **tidak terikat real-time playback** — frame digambar dan
di-encode secepat CPU/GPU bisa, bukan secepat lagu diputar. Inilah yang membuat
render "turbo" sungguhan mungkin, dan tidak mungkin dilakukan murni di browser.

## Kenapa ini lebih cepat dari versi web / dari CapCut

| | Versi web (browser) | App desktop ini |
|---|---|---|
| Cara ambil frame | `canvas.captureStream()` live, terikat playback audio | Frame digambar offline dengan `node-canvas`, secepat CPU/GPU |
| Durasi render | = durasi total lagu (real-time) | = jumlah frame ÷ kecepatan encode (bisa jauh lebih cepat dari real-time) |
| Analisis spektrum | Dihitung live saat audio diputar | **Dihitung di muka (FFT precompute)** untuk seluruh durasi sebelum frame pertama dirender |
| Encoder | `MediaRecorder` browser (software, terbatas) | ffmpeg + GPU encoder (NVENC/QSV/AMF) kalau ada, fallback CPU |
| Codec | WebM saja yang reliable | H.264 / HEVC / WebM penuh, lewat ffmpeg |

## Arsitektur

```
Renderer (UI + live preview, Chromium)
   │  IPC (electron)
   ▼
Main process
   ├─ audioAnalysis.js   → decode tiap track ke PCM (ffmpeg), FFT per-frame, precompute
   │                         array spektrum + beat untuk SELURUH timeline playlist
   ├─ renderPipeline.js  → orkestrasi: analisis → concat audio → pilih encoder → render → mux
   ├─ renderWorker.js    → worker_thread: loop frame node-canvas → pipe raw frame ke ffmpeg stdin
   └─ ffmpegUtil.js      → deteksi h264_nvenc/hevc_nvenc/qsv/amf, fallback libx264/libx265/libvpx-vp9
```

`src/shared/drawing.js` adalah modul "isomorphic": fungsi gambar Canvas2D yang
sama persis dipakai untuk live preview di renderer (browser) dan untuk render
final di worker (node-canvas) — supaya hasil akhir konsisten dengan preview.

## Prasyarat di mesin Windows kamu

1. **Node.js** 18+ (https://nodejs.org)
2. **Build tools untuk native module** (`canvas` package butuh kompilasi native):
   - Termudah: install [`windows-build-tools`] sudah deprecated di Node baru — gunakan
     **Visual Studio Build Tools** (workload "Desktop development with C++") + Python 3.
   - Alternatif tercepat: `npm install --global windows-build-tools` style sudah tidak berlaku;
     cukup pastikan Visual Studio Build Tools + Python terpasang, `node-gyp` akan otomatis pakai itu.
3. **ffmpeg.exe** (build static, sudah termasuk `libx264`, `libx265`, `libvpx-vp9`, dan idealnya `nvenc`):
   - Download dari https://www.gyan.dev/ffmpeg/builds/ (pilih "full" build)
   - Salin `ffmpeg.exe` ke `resources/ffmpeg/ffmpeg.exe` di folder project ini.
4. **GPU driver terbaru** (Nvidia/AMD/Intel) kalau mau encode lewat NVENC/AMF/QSV — opsional,
   tanpa ini app otomatis fallback ke encoder CPU (`libx264`), tetap jalan, hanya lebih lambat.

## Setup

```bash
cd music-render-studio
npm install
npm run rebuild          # kompilasi ulang native module `canvas` untuk versi Node Electron
npm run download-fonts   # download 20 font Google Fonts ke resources/fonts/*.ttf
```

> `download-fonts` butuh koneksi internet biasa (dijalankan di mesin kamu, bukan di sandbox
> pembuatan kode ini). Kalau script gagal (Google sewaktu-waktu mengubah format response),
> alternatif manual: download tiap font dari https://fonts.google.com/specifically langsung,
> lalu simpan file `.ttf`-nya dengan nama persis seperti di `src/shared/constants.js`
> (kolom `file`) ke folder `resources/fonts/`.

Pastikan struktur akhir:
```
resources/
  ffmpeg/ffmpeg.exe
  fonts/Anton-Regular.ttf, BebasNeue-Regular.ttf, ... (20 file)
```

## Jalankan saat development

```bash
npm start
```

## Build installer Windows (.exe / NSIS)

```bash
npm run dist:win
```
Hasil installer ada di folder `dist/`. Installer ini sudah membundel `ffmpeg.exe`
dan font-font tersebut lewat `extraResources` di `package.json`, jadi user akhir
tidak perlu setup manual apapun.

## Fitur yang sudah jalan

- Upload audio multiple, urutan asli/acak, hapus track
- Background: cyberpunk (procedural), green screen, transparan (preview only),
  custom upload gambar **atau video** (video latar di-decode lewat pipe ffmpeg
  terpisah, disinkronkan per-frame ke render loop utama — bukan realtime)
- Animasi latar: tanpa animasi / denyut sesuai beat (dari beat envelope yang sudah
  diprecompute), partikel halus, vignette, 5 color grading
- Logo upload + animasi (rotate pelan, blink lembut, beat pulse) + drag posisi
- Judul & sub-judul: 10 font masing-masing, stroke, shadow, alignment, posisi
  cepat 9-titik + drag manual, size, letter-spacing
- 10 jenis spektrum, 5 tema warna, kontrol sensitivitas/lebar/jumlah bar/gap/tinggi,
  drag posisi
- Output: 16:9/9:16/1:1, 1080p/1440p/4K, FPS 24/30/60, codec H.264/HEVC/WebM
  dengan auto-deteksi encoder GPU
- Progress render menampilkan **kecepatan render relatif terhadap real-time**
  (mis. "4.2x dari real-time") — ini metrik turbo yang sebenarnya

## Batasan yang perlu kamu tahu (jujur, biar tidak salah ekspektasi)

- **HEVC via GPU** hanya akan terpakai kalau ffmpeg build kamu punya `hevc_nvenc`/`hevc_qsv`/`hevc_amf`
  DAN GPU kamu mendukungnya. Kalau tidak ada sama sekali, app fallback ke `libx265` (software,
  lebih lambat) — tetap menghasilkan file HEVC, hanya tidak secepat GPU.
- Background "Transparan" tetap tidak menghasilkan video dengan alpha channel sungguhan
  (kompleksitas alpha video di luar scope ini) — gunakan Green Screen untuk chroma-key.
- Cancel render saat ini menghentikan UI tapi proses ffmpeg/worker yang sedang jalan akan
  selesai sendiri di background (lihat komentar TODO di `ipcHandlers.js` — bisa ditambah
  tracking PID untuk kill paksa kalau dibutuhkan).
- `canvas.toBuffer('raw')` mengeluarkan format BGRA — sudah dicocokkan dengan `-pix_fmt bgra`
  di ffmpeg, jangan diubah salah satu sisi saja kalau modifikasi kode.

## Troubleshooting cepat

- **Error saat `npm install` terkait `canvas`**: pastikan Visual Studio Build Tools (C++) +
  Python 3 terpasang, lalu ulangi `npm install` dan `npm run rebuild`.
- **Render jalan tapi sangat lambat**: cek log `encoder` yang ditampilkan di progress —
  kalau tertulis `libx264`/`libx265` (CPU) padahal kamu punya GPU Nvidia, kemungkinan
  ffmpeg.exe yang dipakai bukan build "full"/tidak dikompilasi dengan dukungan NVENC.
  Download ulang dari gyan.dev build "full".
- **Font tidak muncul sesuai pilihan**: pastikan file `.ttf` di `resources/fonts/` ada dan
  namanya cocok persis dengan kolom `file` di `src/shared/constants.js`.
