// Shared across renderer (browser) and main/worker (node-canvas). No Node-only APIs here.

const TITLE_FONTS = [
  { family: "Anton", file: "Anton-Regular.ttf" },
  { family: "Bebas Neue", file: "BebasNeue-Regular.ttf" },
  { family: "Oswald", file: "Oswald-Bold.ttf" },
  { family: "Poppins", file: "Poppins-Bold.ttf" },
  { family: "Montserrat", file: "Montserrat-Bold.ttf" },
  { family: "Orbitron", file: "Orbitron-Bold.ttf" },
  { family: "Russo One", file: "RussoOne-Regular.ttf" },
  { family: "Permanent Marker", file: "PermanentMarker-Regular.ttf" },
  { family: "Pacifico", file: "Pacifico-Regular.ttf" },
  { family: "Righteous", file: "Righteous-Regular.ttf" },
];

const SUBTITLE_FONTS = [
  { family: "Inter", file: "Inter-Regular.ttf" },
  { family: "Roboto", file: "Roboto-Regular.ttf" },
  { family: "Lato", file: "Lato-Regular.ttf" },
  { family: "Open Sans", file: "OpenSans-Regular.ttf" },
  { family: "Nunito", file: "Nunito-Regular.ttf" },
  { family: "Work Sans", file: "WorkSans-Regular.ttf" },
  { family: "Source Sans Pro", file: "SourceSansPro-Regular.ttf" },
  { family: "Mukta", file: "Mukta-Regular.ttf" },
  { family: "Karla", file: "Karla-Regular.ttf" },
  { family: "DM Sans", file: "DMSans-Regular.ttf" },
];

const ALL_FONTS = [...TITLE_FONTS, ...SUBTITLE_FONTS];

const RESOLUTIONS = {
  "16:9": { 1080: [1920, 1080], 1440: [2560, 1440], 2160: [3840, 2160] },
  "9:16": { 1080: [1080, 1920], 1440: [1440, 2560], 2160: [2160, 3840] },
  "1:1": { 1080: [1080, 1080], 1440: [1440, 1440], 2160: [2160, 2160] },
};

const SPECTRUM_STYLES = [
  "Bar Vertikal", "Bar Horizontal", "Mirror Bar", "Waveform Line", "Radial Circular",
  "Dot Matrix", "Block Pulse", "Wave Halus", "Neon Glow Bar", "Symmetric Center",
];

const COLOR_THEMES = ["Pelangi", "Neon", "Matrix", "Purple Glow", "Solid"];

const GRADES = ["none", "warm", "cool", "vintage", "vibrant"];

module.exports = { TITLE_FONTS, SUBTITLE_FONTS, ALL_FONTS, RESOLUTIONS, SPECTRUM_STYLES, COLOR_THEMES, GRADES };
