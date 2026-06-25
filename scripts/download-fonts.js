// Run this once on your own machine (it needs real internet access, unlike the
// sandbox this project was generated in): `npm run download-fonts`
// It fetches the 20 fonts used by the Title/Subtitle text features and saves
// them as .ttf into resources/fonts/, matching the filenames in src/shared/constants.js

const https = require("https");
const fs = require("fs");
const path = require("path");
const { ALL_FONTS } = require("../src/shared/constants");

const OUT_DIR = path.join(__dirname, "..", "resources", "fonts");
fs.mkdirSync(OUT_DIR, { recursive: true });

// Old user-agent string makes Google Fonts serve plain .ttf instead of woff2.
const OLD_UA = "Mozilla/4.0 (compatible; MSIE 6.0; Windows NT 5.1)";

function fetchCss(family) {
  const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}&display=swap`;
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": OLD_UA } }, (res) => {
      let data = "";
      res.on("data", (d) => (data += d));
      res.on("end", () => resolve(data));
    }).on("error", reject);
  });
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) return reject(new Error("HTTP " + res.statusCode + " for " + url));
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on("finish", () => file.close(resolve));
    }).on("error", reject);
  });
}

async function main() {
  for (const f of ALL_FONTS) {
    const dest = path.join(OUT_DIR, f.file);
    if (fs.existsSync(dest)) { console.log("skip (exists):", f.file); continue; }
    try {
      const css = await fetchCss(f.family);
      const match = css.match(/url\((https:[^)]+\.ttf)\)/);
      if (!match) { console.warn("no ttf url found for", f.family, "- Google may have changed response format, see README for manual fallback"); continue; }
      await download(match[1], dest);
      console.log("downloaded:", f.file);
    } catch (e) {
      console.warn("failed:", f.family, e.message);
    }
  }
  console.log("Done. Fonts saved to", OUT_DIR);
}

main();
