// get-loader.js
//
// Automates entering your key on launcher.linear.pub and downloading the loader.
// It launches the downloaded loader automatically after saving it.
//
// Usage:
//   node get-loader.js            -> uses the "current" key from keys.txt
//   node get-loader.js MYKEY123   -> uses the key you pass on the command line

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile, execFileSync, spawn } = require("child_process");
const readline = require("readline");
const { chromium } = require("playwright");

const SITE_URL = "https://launcher.linear.pub/";
const KEYS_FILE = path.join(__dirname, "keys.txt");
const EXE_TYPE_FILE = path.join(__dirname, "exe-type.txt");
const EXE_TYPE_BOOT_STATE_FILE = path.join(__dirname, "exe-type-boot-state.json");
// While this file exists (and holds a live PID) the loader is considered
// running, so "Switch Spoofer Type" refuses to open at the same time.
const LOADER_LOCK_FILE = path.join(__dirname, ".loader-running.lock");
const BROWSER_PROFILE_DIR = path.join(__dirname, ".browser-profile");
const DOWNLOAD_DIR = path.join(__dirname, "downloads");
const DIAGNOSTICS_DIR = path.join(DOWNLOAD_DIR, "diagnostics");
const SHOW_BROWSER = envFlag("LINEAR_SHOW_BROWSER");
const RUN_DOWNLOADED = !envFlag("LINEAR_NO_RUN");
const DEFAULT_TIMEOUT_MS = 15000;
const FAST_ACTION_TIMEOUT_MS = 300;
const OPTIONAL_CONTINUE_TIMEOUT_MS = 350;
const OPTIONAL_CONTINUE_TEXT_TIMEOUT_MS = 250;
const GENERATE_TIMEOUT_MS = 30000;
const KEY_SUBMIT_RETRY_MS = 150;
const HYDRATED_SUBMIT_FALLBACK_MS = 600;
const DOWNLOAD_TIMEOUT_MS = 120000;
const DOWNLOAD_RECOVERY_TIMEOUT_MS = 10000;
// Navigation resilience: short per-attempt timeout, retried until the overall
// window elapses, so the loader waits out a missing connection and recovers the
// instant it returns instead of dying.
const NAV_ATTEMPT_TIMEOUT_MS = 20000;
const NAV_RETRY_DELAY_MS = 1200;
const NAV_TOTAL_TIMEOUT_MS = 120000;
const KEY_TIME_READ_TIMEOUT_MS = 250;
const KEY_TIME_SYNC_MS = 500;
const STATUS_TICK_MS = 120;
const BLOCKED_RESOURCE_TYPES = new Set(["image", "font", "media"]);
const KEY_LENGTH = 50;
const KEY_PATTERN = /^[A-Za-z0-9]{50}$/;
const PASTE_REJECT_DELAY_MS = 180;
const CLIPBOARD_POLL_MS = 300;
const EXE_TYPE_DEFAULT = "no";

const ANSI = {
  reset: "\x1b[0m",
  red: "\x1b[91m",
};

const KEY_TIME_CONTEXT =
  /\b(time\s*(?:left|remaining)|remaining\s*time|key\s*(?:time|expires?|expiry|expiration)|expires?\s*(?:in|on|at)|valid\s*(?:for|until)|duration)\b/i;
const DURATION_UNITS =
  "years?|yrs?|months?|mos?|weeks?|wks?|days?|hrs?|hours?|mins?|minutes?|secs?|seconds?|y|mo|w|d|h|m|s";
const DURATION_PATTERN = new RegExp(
  `\\b\\d+\\s*(?:${DURATION_UNITS})\\b(?:\\s*,?\\s*\\d+\\s*(?:${DURATION_UNITS})\\b){0,5}`,
  "gi"
);
const CLOCK_PATTERN = /\b\d{1,2}:\d{2}(?::\d{2})?\b/g;

// "ANSI Shadow" 3D block font used for the main banner.
const SHADOW_HEIGHT = 6;
const SHADOW_LETTERS = {
  "0": [
    " ███╗ ",
    "██╔██╗",
    "██║██║",
    "██║██║",
    "╚███╔╝",
    " ╚══╝ ",
  ],
  "1": [
    " ██╗  ",
    "███║  ",
    "╚██║  ",
    " ██║  ",
    "█████╗",
    "╚════╝",
  ],
  "2": [
    "████╗ ",
    "╚══██╗",
    " ███╔╝",
    "██╔══╝",
    "█████╗",
    "╚════╝",
  ],
  "3": [
    "████╗ ",
    "╚══██╗",
    " ███╔╝",
    " ╚═██╗",
    "████╔╝",
    "╚═══╝ ",
  ],
  "4": [
    "██╗██╗",
    "██║██║",
    "█████║",
    "╚══██║",
    "   ██║",
    "   ╚═╝",
  ],
  "5": [
    "█████╗",
    "██╔══╝",
    "████╗ ",
    "╚══██╗",
    "████╔╝",
    "╚═══╝ ",
  ],
  "6": [
    " ███╗ ",
    "██╔══╝",
    "████╗ ",
    "██╔██╗",
    "╚███╔╝",
    " ╚══╝ ",
  ],
  "7": [
    "█████╗",
    "╚══██║",
    "   ██║",
    "  ██╔╝",
    "  ██║ ",
    "  ╚═╝ ",
  ],
  "8": [
    " ███╗ ",
    "██╔██╗",
    "╚███╔╝",
    "██╔██╗",
    "╚███╔╝",
    " ╚══╝ ",
  ],
  "9": [
    " ███╗ ",
    "██╔██╗",
    "╚████║",
    " ╚═██║",
    " ███╔╝",
    " ╚══╝ ",
  ],
  A: [
    " █████╗ ",
    "██╔══██╗",
    "███████║",
    "██╔══██║",
    "██║  ██║",
    "╚═╝  ╚═╝",
  ],
  B: [
    "██████╗ ",
    "██╔══██╗",
    "██████╔╝",
    "██╔══██╗",
    "██████╔╝",
    "╚═════╝ ",
  ],
  C: [
    " ██████╗",
    "██╔════╝",
    "██║     ",
    "██║     ",
    "╚██████╗",
    " ╚═════╝",
  ],
  D: [
    "██████╗ ",
    "██╔══██╗",
    "██║  ██║",
    "██║  ██║",
    "██████╔╝",
    "╚═════╝ ",
  ],
  E: [
    "███████╗",
    "██╔════╝",
    "█████╗  ",
    "██╔══╝  ",
    "███████╗",
    "╚══════╝",
  ],
  H: [
    "██╗  ██╗",
    "██║  ██║",
    "███████║",
    "██╔══██║",
    "██║  ██║",
    "╚═╝  ╚═╝",
  ],
  I: [
    "██╗",
    "██║",
    "██║",
    "██║",
    "██║",
    "╚═╝",
  ],
  K: [
    "██╗  ██╗",
    "██║ ██╔╝",
    "█████╔╝ ",
    "██╔═██╗ ",
    "██║  ██╗",
    "╚═╝  ╚═╝",
  ],
  L: [
    "██╗     ",
    "██║     ",
    "██║     ",
    "██║     ",
    "███████╗",
    "╚══════╝",
  ],
  M: [
    "███╗   ███╗",
    "████╗ ████║",
    "██╔████╔██║",
    "██║╚██╔╝██║",
    "██║ ╚═╝ ██║",
    "╚═╝     ╚═╝",
  ],
  N: [
    "███╗   ██╗",
    "████╗  ██║",
    "██╔██╗ ██║",
    "██║╚██╗██║",
    "██║ ╚████║",
    "╚═╝  ╚═══╝",
  ],
  O: [
    " █████╗ ",
    "██╔══██╗",
    "██║  ██║",
    "██║  ██║",
    "╚█████╔╝",
    " ╚════╝ ",
  ],
  P: [
    "██████╗ ",
    "██╔══██╗",
    "██████╔╝",
    "██╔═══╝ ",
    "██║     ",
    "╚═╝     ",
  ],
  R: [
    "██████╗ ",
    "██╔══██╗",
    "██████╔╝",
    "██╔══██╗",
    "██║  ██║",
    "╚═╝  ╚═╝",
  ],
  T: [
    "████████╗",
    "╚══██╔══╝",
    "   ██║   ",
    "   ██║   ",
    "   ██║   ",
    "   ╚═╝   ",
  ],
  U: [
    "██╗   ██╗",
    "██║   ██║",
    "██║   ██║",
    "██║   ██║",
    "╚██████╔╝",
    " ╚═════╝ ",
  ],
  Y: [
    "██╗   ██╗",
    "╚██╗ ██╔╝",
    " ╚████╔╝ ",
    "  ╚██╔╝  ",
    "   ██║   ",
    "   ╚═╝   ",
  ],
  ".": [
    "   ",
    "   ",
    "   ",
    "   ",
    "██╗",
    "╚═╝",
  ],
  " ": ["     ", "     ", "     ", "     ", "     ", "     "],
};

function makeLetterArt(text) {
  const rows = Array.from({ length: SHADOW_HEIGHT }, () => "");

  for (const char of text.toUpperCase()) {
    const glyph = SHADOW_LETTERS[char] || SHADOW_LETTERS[" "];
    for (let row = 0; row < SHADOW_HEIGHT; row += 1) {
      rows[row] += glyph[row];
    }
  }

  return rows.map((row) => row.replace(/\s+$/, "")).join("\n");
}

// Legacy compact solid-block font, kept available if a smaller prompt is needed.
const SMALL_HEIGHT = 3;
const SMALL_LETTERS = {
  "0": ["█▀█", "█ █", "▀▀▀"],
  "1": ["▄█ ", " █ ", "▀▀▀"],
  "2": ["▀▀█", "█▀▀", "▀▀▀"],
  "3": ["▀▀█", " ▀█", "▀▀▀"],
  "4": ["█ █", "▀▀█", "  ▀"],
  "5": ["█▀▀", "▀▀█", "▀▀▀"],
  "6": ["█▀▀", "█▀█", "▀▀▀"],
  "7": ["▀▀█", "  █", "  ▀"],
  "8": ["█▀█", "█▀█", "▀▀▀"],
  "9": ["█▀█", "▀▀█", "▀▀▀"],
  D: ["█▀▄", "█ █", "▀▀ "],
  H: ["█ █", "█▀█", "▀ ▀"],
  M: ["█▄ ▄█", "█ ▀ █", "▀   ▀"],
  E: ["█▀▀", "█▀▀", "▀▀▀"],
  N: ["█▄ █", "█ ▀█", "▀  ▀"],
  T: ["▀█▀", " █ ", " ▀ "],
  R: ["█▀█", "█▀▄", "▀ ▀"],
  K: ["█ █", "█▀▄", "▀ ▀"],
  Y: ["█ █", " █ ", " ▀ "],
  " ": ["  ", "  ", "  "],
};

function makeSmallArt(text) {
  const rows = Array.from({ length: SMALL_HEIGHT }, () => "");
  const chars = [...text.toUpperCase()];

  chars.forEach((char, index) => {
    const glyph = SMALL_LETTERS[char] || SMALL_LETTERS[" "];
    for (let row = 0; row < SMALL_HEIGHT; row += 1) {
      rows[row] += glyph[row];
      if (index < chars.length - 1) {
        rows[row] += " ";
      }
    }
  });

  return rows.map((row) => row.replace(/\s+$/, "")).join("\n");
}

const HEADER_PIXEL_HEIGHT = 5;
const HEADER_PIXEL_ON = "█";
const HEADER_PIXEL_OFF = " ";
const HEADER_PIXEL_GAP = "  ";
const HEADER_PIXEL_LETTERS = {
  "0": ["111", "101", "101", "101", "111"],
  "1": ["010", "110", "010", "010", "111"],
  "2": ["111", "001", "111", "100", "111"],
  "3": ["111", "001", "111", "001", "111"],
  "4": ["101", "101", "111", "001", "001"],
  "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"],
  "7": ["111", "001", "010", "010", "010"],
  "8": ["111", "101", "111", "101", "111"],
  "9": ["111", "101", "111", "001", "111"],
  C: ["111", "100", "100", "100", "111"],
  D: ["110", "101", "101", "101", "110"],
  E: ["111", "100", "111", "100", "111"],
  H: ["101", "101", "111", "101", "101"],
  K: ["101", "101", "110", "101", "101"],
  // 5 pixels wide with the classic centre "peak" so it reads clearly as M and
  // can't be mistaken for H (glyphs may be wider than the default 3 pixels).
  M: ["10001", "11011", "10101", "10001", "10001"],
  O: ["111", "101", "101", "101", "111"],
  P: ["111", "101", "111", "100", "100"],
  S: ["0111", "1000", "0110", "0001", "1110"],
  Y: ["101", "101", "010", "010", "010"],
  ":": ["0", "1", "0", "1", "0"],
  " ": ["0", "0", "0", "0", "0"],
};

function makeHeaderPixelArt(text) {
  const rows = Array.from({ length: HEADER_PIXEL_HEIGHT }, () => "");
  const chars = [...text.toUpperCase()];

  chars.forEach((char, index) => {
    const glyph = HEADER_PIXEL_LETTERS[char] || HEADER_PIXEL_LETTERS[" "];
    for (let row = 0; row < HEADER_PIXEL_HEIGHT; row += 1) {
      rows[row] += [...glyph[row]]
        .map((pixel) => (pixel === "1" ? HEADER_PIXEL_ON : HEADER_PIXEL_OFF))
        .join("");
      if (index < chars.length - 1) {
        rows[row] += HEADER_PIXEL_GAP;
      }
    }
  });

  return rows.map((row) => row.replace(/\s+$/, "")).join("\n");
}

const LINEAR_ART = makeLetterArt("LINEAR.PUB");
const LINEAR_WIDTH = Math.max(
  ...LINEAR_ART.split(/\r?\n/).map((line) => [...line].length)
);

// A gentle blue-to-blue gradient used by the time block, stars and accents.
const BANNER_GRADIENT_START = [105, 170, 255];
const BANNER_GRADIENT_END = [40, 100, 235];
// A red gradient used for rejected-key feedback.
const REJECT_GRADIENT_START = [255, 125, 125];
const REJECT_GRADIENT_END = [215, 25, 70];
// "LINEAR." is drawn in white; "PUB" in one solid blue (no gradient).
const LINEAR_WHITE = [240, 242, 248];
const PUB_BLUE = [0, 76, 200];
const LINEAR_PUB_SPLIT = ["L", "I", "N", "E", "A", "R", "."].reduce(
  (total, char) => total + SHADOW_LETTERS[char][0].length,
  0
);
// A brushed-charcoal gradient for the key / status text.
const CHARCOAL_START = [104, 109, 120];
const CHARCOAL_END = [188, 193, 205];

// Layout rows (1-indexed). We clear the screen and draw from the top, so these
// stay fixed and can be rewritten in place. The time zone starts blank, hosts
// COPY KEY while a key is being entered, and later shows the key time.
const TOP_GAP = 1;
const LINEAR_HEIGHT = LINEAR_ART.split(/\r?\n/).length;
// Keep the key/time art visually centred between LINEAR.PUB and the text below.
const HEADER_BLOCK_GAP = 2;
const TIME_HEIGHT = HEADER_PIXEL_HEIGHT;
const TIME_ROW = TOP_GAP + LINEAR_HEIGHT + HEADER_BLOCK_GAP + 1;
const CONTENT_ROW = TIME_ROW + TIME_HEIGHT + 1;
// Evenly spaced from the key line down: key on CONTENT_ROW, a blank, the spoofer
// row, a blank, then the status board. Keeping these as fixed absolute rows lets
// each block draw at a known spot regardless of where earlier output (like the
// initial spoofer prompt) left the cursor.
const SPOOFER_ROW = CONTENT_ROW + 2;
const STATUS_BOARD_TOP_ROW = CONTENT_ROW + 4;
const DEFAULT_TERM_COLUMNS = 82;
const PROMPT_WINDOW_ROWS = TIME_ROW + TIME_HEIGHT + 1;

function color(text, ansiColor) {
  return `${ansiColor}${text}${ANSI.reset}`;
}

function colorRgb(text, rgb) {
  const [r, g, b] = rgb;
  return `\x1b[38;2;${r};${g};${b}m${text}${ANSI.reset}`;
}

function blendColor(start, end, amount) {
  return start.map((value, index) =>
    Math.round(value + (end[index] - value) * amount)
  );
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// Colour each visible character by its absolute column, so multi-row art reads
// as one smooth left-to-right sweep. `colorAt(column, width)` returns the rgb.
function paintColumns(text, colorAt) {
  const lines = text.split(/\r?\n/);
  const width = Math.max(1, ...lines.map((line) => [...line].length));

  return lines
    .map((line) => {
      let output = "";
      let activeColor = "";

      [...line].forEach((char, column) => {
        if (char === " ") {
          output += char;
          return;
        }

        const [r, g, b] = colorAt(column, width);
        const colorCode = `\x1b[38;2;${r};${g};${b}m`;

        if (colorCode !== activeColor) {
          output += colorCode;
          activeColor = colorCode;
        }

        output += char;
      });

      return `${output}${activeColor ? ANSI.reset : ""}`;
    })
    .join("\n");
}

function bannerGradient(text) {
  return paintColumns(text, (column, width) =>
    blendColor(
      BANNER_GRADIENT_START,
      BANNER_GRADIENT_END,
      width <= 1 ? 0 : column / (width - 1)
    )
  );
}

// Brushed-charcoal sweep for the key / status text.
function charcoalGradient(text) {
  return paintColumns(text, (column, width) =>
    blendColor(CHARCOAL_START, CHARCOAL_END, width <= 1 ? 0 : column / (width - 1))
  );
}

// "LINEAR." in flat white, "PUB" in one solid blue.
function linearPubBanner() {
  return paintColumns(LINEAR_ART, (column) =>
    column < LINEAR_PUB_SPLIT ? LINEAR_WHITE : PUB_BLUE
  );
}

function termWidth() {
  return process.stdout.columns || DEFAULT_TERM_COLUMNS;
}

// Centre a painted art block by the raw (uncoloured) art's widest line.
function centerArt(rawArt, paintedArt) {
  const rawLines = rawArt.split(/\r?\n/);
  const artWidth = Math.max(...rawLines.map((line) => [...line].length));
  const pad = " ".repeat(Math.max(0, Math.floor((termWidth() - artWidth) / 2)));

  return paintedArt
    .split(/\r?\n/)
    .map((line) => pad + line)
    .join("\n");
}

// Small blue-gradient art, centred, returned as individual lines.
function centeredSmallArtLines(text) {
  const raw = makeSmallArt(text);
  return centerArt(raw, bannerGradient(raw)).split(/\r?\n/);
}

function centeredHeaderArtLines(text) {
  const raw = makeHeaderPixelArt(text);
  return centerArt(raw, bannerGradient(raw)).split(/\r?\n/);
}

function contentWidth() {
  const available = Math.max(1, termWidth() - 2);
  return Math.max(STATUS_DOT_COLUMN + 1, Math.min(available, LINEAR_WIDTH));
}

// Shared left margin for the text block (key line, statuses, prompt) so the
// whole group fills the banner width and sits centred in the window.
function contentMargin() {
  return Math.max(0, Math.floor((termWidth() - contentWidth()) / 2));
}

function contentPad() {
  return " ".repeat(contentMargin());
}

function gradientColorAt(amount) {
  return blendColor(BANNER_GRADIENT_START, BANNER_GRADIENT_END, clamp(amount, 0, 1));
}

function rejectGradientColorAt(amount) {
  return blendColor(REJECT_GRADIENT_START, REJECT_GRADIENT_END, clamp(amount, 0, 1));
}

// A "*" tinted along the blue banner gradient by its position in the key, so a
// pasted/typed key shows up as a blue gradient instead of plain white stars.
function maskStar(index, length = KEY_LENGTH) {
  const amount = length <= 1 ? 0 : index / (length - 1);
  return colorRgb("*", gradientColorAt(amount));
}

function rejectMaskStar(index, length = KEY_LENGTH) {
  const amount = length <= 1 ? 0 : index / (length - 1);
  return colorRgb("*", rejectGradientColorAt(amount));
}

// A "*" whose colour drifts back and forth through the gradient to shimmer.
function shimmerStar(frame) {
  const amount = (Math.sin(frame * 0.35) + 1) / 2;
  return colorRgb("*", gradientColorAt(amount));
}

function rejectShimmerStar(frame) {
  const amount = (Math.sin(frame * 0.35) + 1) / 2;
  return colorRgb("*", rejectGradientColorAt(amount));
}

// Retract the row of key stars back into the prompt star, like it worms in.
async function animateStarsRetract(count, options = {}) {
  if (!canMoveCursor()) {
    return;
  }

  const shouldStop =
    typeof options.shouldStop === "function" ? options.shouldStop : () => false;
  const pad = contentPad();
  const starCount = Math.max(1, Math.min(KEY_LENGTH, Math.trunc(count) || 0));
  const promptStar = options.reject ? rejectShimmerStar : shimmerStar;
  const rowStar = options.reject ? rejectMaskStar : maskStar;

  for (let remaining = starCount; remaining > 0; remaining -= 3) {
    // Bail without clearing if the key was accepted mid-animation, so we don't
    // wipe the accepted key that finish() just drew.
    if (shouldStop()) {
      return;
    }
    let line = `${pad}${promptStar(remaining)} `;
    for (let i = 0; i < remaining; i += 1) {
      line += rowStar(i, starCount);
    }
    process.stdout.cursorTo(0);
    process.stdout.clearLine(0);
    process.stdout.write(line);
    await sleep(18);
  }

  if (shouldStop()) {
    return;
  }
  process.stdout.cursorTo(0);
  process.stdout.clearLine(0);
}

// Result marker: theme blue when a step passed, red when it didn't.
function statusDot(passed) {
  return passed ? colorRgb("●", BANNER_GRADIENT_END) : color("●", ANSI.red);
}

class FriendlyError extends Error {
  constructor(message, code = "failed") {
    super(message);
    this.isFriendly = true;
    this.code = code;
  }
}

function envFlag(name) {
  return /^(1|true|yes|on)$/i.test(String(process.env[name] || ""));
}

let currentTimeZoneLines = null;
let currentKeyValue = "";
let currentKeyLine = "";
let currentSpooferPlan = null;
let currentSpooferLine = "";
let activeStatusBoard = null;
let desiredConsoleRows = PROMPT_WINDOW_ROWS;
let consoleResizeTimer = null;
let fittingConsoleWindow = false;
let consoleLockTimer = null;

function markConsoleFitSettled() {
  const timer = setTimeout(() => {
    fittingConsoleWindow = false;
  }, 200);
  if (typeof timer.unref === "function") {
    timer.unref();
  }
}

function fitConsoleWindow(rows = desiredConsoleRows) {
  desiredConsoleRows = Math.max(10, Math.trunc(rows) || PROMPT_WINDOW_ROWS);

  if (process.platform !== "win32" || !process.stdout.isTTY) {
    return;
  }

  fittingConsoleWindow = true;
  try {
    execFileSync(
      process.env.ComSpec || "cmd.exe",
      ["/d", "/s", "/c", `mode con: cols=${DEFAULT_TERM_COLUMNS} lines=${desiredConsoleRows}`],
      { timeout: 1500, windowsHide: true, stdio: "ignore" }
    );
  } catch {
    // Resizing is cosmetic; the layout still redraws against the current window.
  } finally {
    configureConsole({ quickEdit: false, pinTopmost: false });
    markConsoleFitSettled();
  }
}

function writeAbsoluteLine(row, line) {
  if (!canMoveCursor()) {
    return;
  }

  process.stdout.write("\x1b[s");
  process.stdout.write(`\x1b[${row};1H`);
  process.stdout.clearLine(0);
  process.stdout.write(line);
  process.stdout.write("\x1b[u");
}

function drawBaseBanner() {
  if (!process.stdout.isTTY) {
    return;
  }

  process.stdout.write("\x1b[2J\x1b[H\x1b[?25l");
  process.stdout.write("\n".repeat(TOP_GAP));
  console.log(centerArt(LINEAR_ART, linearPubBanner()));
}

function redrawLayout() {
  if (!canMoveCursor()) {
    return;
  }

  drawBaseBanner();
  drawTimeZone(currentTimeZoneLines, { remember: false });

  if (currentKeyValue) {
    currentKeyLine = keyStatusLine(currentKeyValue);
    writeAbsoluteLine(CONTENT_ROW, currentKeyLine);
  }

  if (currentSpooferPlan) {
    currentSpooferLine = spooferStatusLine(currentSpooferPlan);
    for (let row = CONTENT_ROW + 1; row < STATUS_BOARD_TOP_ROW; row += 1) {
      process.stdout.write(`\x1b[${row};1H`);
      process.stdout.clearLine(0);
      if (row === SPOOFER_ROW) {
        process.stdout.write(currentSpooferLine);
      }
    }
  }

  if (activeStatusBoard) {
    activeStatusBoard.redraw();
  }
}

function scheduleLayoutRedraw() {
  if (fittingConsoleWindow || !canMoveCursor()) {
    return;
  }

  if (consoleResizeTimer) {
    clearTimeout(consoleResizeTimer);
  }

  consoleResizeTimer = setTimeout(() => {
    consoleResizeTimer = null;
    fitConsoleWindow(desiredConsoleRows);
    redrawLayout();
  }, 120);
}

function installResizeHandler() {
  if (process.stdout && typeof process.stdout.on === "function") {
    process.stdout.on("resize", scheduleLayoutRedraw);
  }
}

function startConsoleLockWatchdog() {
  if (consoleLockTimer || process.platform !== "win32" || !process.stdout.isTTY) {
    return;
  }

  consoleLockTimer = setInterval(() => {
    configureConsoleAsync({ quickEdit: false, pinTopmost: false });
  }, 4000);

  if (typeof consoleLockTimer.unref === "function") {
    consoleLockTimer.unref();
  }
}

function printStartupBanner() {
  currentTimeZoneLines = null;
  currentKeyValue = "";
  currentKeyLine = "";
  currentSpooferPlan = null;
  currentSpooferLine = "";
  activeStatusBoard = null;
  fitConsoleWindow(PROMPT_WINDOW_ROWS);

  // Clear and home so the fixed-row layout below always anchors to the top,
  // and hide the hardware cursor so it can't blink around while we redraw.
  drawBaseBanner();
  // Leave the time zone blank (it fills in once the key time is known) and
  // land the cursor on the small prompt window's last row.
  if (canMoveCursor()) {
    process.stdout.write(`\x1b[${PROMPT_WINDOW_ROWS};1H`);
  } else {
    process.stdout.write("\n".repeat(PROMPT_WINDOW_ROWS - (TOP_GAP + LINEAR_HEIGHT + 1)));
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function closeBrowserQuietly(browser) {
  if (!browser) {
    return;
  }

  try {
    await browser.close();
  } catch {
    // The process is already finished or closing.
  }
}

let activeBrowser = null;
let cancellationStarted = false;

function trackBrowserClose(browser) {
  return closeBrowserQuietly(browser).finally(() => {
    if (activeBrowser === browser) {
      activeBrowser = null;
    }
  });
}

function browserLooksClosed(browser, page) {
  if (page && page.isClosed()) {
    return true;
  }

  if (browser && typeof browser.isConnected === "function") {
    return !browser.isConnected();
  }

  return !browser && !page;
}

async function waitForVisibleBrowserClose(browser, page) {
  while (!browserLooksClosed(browser, page)) {
    await sleep(500);
  }

  if (activeBrowser === browser) {
    activeBrowser = null;
  }
}

function installCancellationHandlers() {
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => {
      void cancelRun(signal);
    });
  }
}

async function cancelRun(signal) {
  if (cancellationStarted) {
    process.exit(130);
  }

  cancellationStarted = true;
  showCursor();

  try {
    if (process.stdout.isTTY) {
      process.stdout.write(`\n${color(`cancelled by ${signal}, closing...`, ANSI.red)}\n`);
    }
    await closeBrowserQuietly(activeBrowser);
  } finally {
    process.exit(130);
  }
}

function maskSensitiveText(text, key) {
  let output = String(text || "");
  const cleanKey = normalizeEnteredKey(key);

  if (cleanKey) {
    output = output.split(cleanKey).join(maskKey(cleanKey));
  }

  return output;
}

async function writeFailureDiagnostics(page, key, reason) {
  fs.mkdirSync(DIAGNOSTICS_DIR, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const basePath = path.join(DIAGNOSTICS_DIR, `generate-missing-${stamp}`);
  const textPath = `${basePath}.txt`;
  const htmlPath = `${basePath}.html`;
  const screenshotPath = `${basePath}.png`;
  const maskedKey = maskKey(normalizeEnteredKey(key));

  await page
    .evaluate((maskValue) => {
      for (const field of document.querySelectorAll("input, textarea")) {
        if (field.value) {
          field.value = field.value.replace(/[A-Za-z0-9]{50}/g, maskValue);
        }
      }
    }, maskedKey)
    .catch(() => {});

  const [title, bodyText, html] = await Promise.all([
    page.title().catch(() => ""),
    page.locator("body").innerText({ timeout: 1000 }).catch(() => ""),
    page.content().catch(() => ""),
  ]);

  const report = [
    `Reason: ${reason}`,
    `URL: ${page.url()}`,
    `Title: ${title || "(no title)"}`,
    "",
    "Visible page text:",
    maskSensitiveText(bodyText || "(no visible text)", key),
  ].join("\r\n");

  fs.writeFileSync(textPath, report, "utf8");
  fs.writeFileSync(htmlPath, maskSensitiveText(html, key), "utf8");
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});

  return { textPath, htmlPath, screenshotPath };
}

function getBrowserLaunchOptions() {
  return {
    headless: !SHOW_BROWSER,
    slowMo: SHOW_BROWSER ? 250 : 0,
    args: [
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-default-apps",
      "--disable-sync",
      "--no-first-run",
    ],
  };
}

async function blockHeavyResources(page) {
  await page.route("**/*", (route) => {
    const type = route.request().resourceType();
    if (BLOCKED_RESOURCE_TYPES.has(type)) {
      return route.abort();
    }
    return route.continue();
  });
}

async function createAutomationPage(options = {}) {
  const context = await chromium.launchPersistentContext(BROWSER_PROFILE_DIR, {
    ...getBrowserLaunchOptions(),
    acceptDownloads: options.acceptDownloads !== false,
  });
  const browser = context.browser() || context;
  const pages = context.pages();
  const page = pages[0] || (await context.newPage());
  page.setDefaultTimeout(DEFAULT_TIMEOUT_MS);
  await blockHeavyResources(page);

  return { browser, context, page };
}

function canMoveCursor() {
  return (
    process.stdout.isTTY &&
    process.stdout.clearLine &&
    process.stdout.cursorTo &&
    process.stdout.moveCursor
  );
}

function formatTwoDigits(value) {
  return String(Math.max(0, Number.parseInt(value, 10) || 0)).padStart(2, "0");
}

function parseClockTime(text) {
  const match = String(text || "").match(/\b(\d{1,2}):(\d{2})(?::(\d{2}))?\b/);
  if (!match) {
    return null;
  }

  if (match[3] !== undefined) {
    return { d: "0", h: match[1], m: match[2], s: match[3] };
  }

  return { d: "0", h: "0", m: match[1], s: match[2] };
}

function extractUnitTime(text) {
  const source = String(text || "");
  const unit = (pattern) => {
    const match = source.match(pattern);
    return match ? match[1] : "0";
  };
  const values = {
    d: unit(/(\d+)\s*(?:d|day|days)\b/i),
    h: unit(/(\d+)\s*(?:h|hr|hrs|hour|hours)\b/i),
    m: unit(/(\d+)\s*(?:m|min|mins|minute|minutes)\b/i),
    s: unit(/(\d+)\s*(?:s|sec|secs|second|seconds)\b/i),
  };

  return Object.values(values).some((value) => value !== "0") ? values : null;
}

// Pull days / hours / minutes / seconds out of the site's time string.
function extractDHMS(text) {
  if (!text || typeof text !== "string") {
    return null;
  }

  return extractUnitTime(text) || parseClockTime(text);
}

function keyTimeHeaderText(timeLeft) {
  const time = extractDHMS(timeLeft);
  if (!time) {
    return "";
  }

  return `${time.d}D ${formatTwoDigits(time.h)}H ${formatTwoDigits(time.m)}M ${formatTwoDigits(time.s)}S`;
}

// Fill the reserved time zone with a block of small art (or clear it).
function drawTimeZone(lines, options = {}) {
  if (options.remember !== false) {
    currentTimeZoneLines = lines || null;
  }

  if (!canMoveCursor()) {
    if (lines) {
      console.log(lines.join("\n"));
    }
    return;
  }

  process.stdout.write("\x1b[s");
  for (let i = 0; i < TIME_HEIGHT; i += 1) {
    process.stdout.write(`\x1b[${TIME_ROW + i};1H`);
    process.stdout.clearLine(0);
    if (lines && i < lines.length) {
      process.stdout.write(lines[i]);
    }
  }
  process.stdout.write("\x1b[u");
}

// Show the key time as banner art ("17D 20H 30M 45S"). Until the site reports a
// parsable time, the zone simply stays empty - no placeholder dashes.
function updateHeaderKeyTime(timeLeft) {
  const text = keyTimeHeaderText(timeLeft);
  if (!text) {
    return;
  }

  drawTimeZone(centeredHeaderArtLines(text));
}

const STATUS_STEPS = [
  { key: "access", label: "accessing website" },
  { key: "enterKey", label: "entering key" },
  { key: "generate", label: "generating loader" },
  { key: "run", label: "running loader" },
];
const STATUS_SPEED_WIDTH = 9;
const STATUS_LABEL_WIDTH = Math.max(...STATUS_STEPS.map((step) => step.label.length));
const STATUS_ROW_GAP = 1;
const STATUS_BOARD_STEP_COUNT = STATUS_STEPS.length + 1;
const STATUS_BOARD_HEIGHT =
  STATUS_BOARD_STEP_COUNT + STATUS_ROW_GAP * Math.max(0, STATUS_BOARD_STEP_COUNT - 1);
const RUN_WINDOW_ROWS = STATUS_BOARD_TOP_ROW + STATUS_BOARD_HEIGHT;
// The column every dot lines up on: "status: " + widest label + " " + "100%" +
// " " + speed field + one space before the dot.
const STATUS_DOT_COLUMN =
  "status: ".length + STATUS_LABEL_WIDTH + 1 + 4 + 1 + STATUS_SPEED_WIDTH + 1;

// Pad by visible width, ignoring ANSI colour codes, so coloured cells still align.
function padVisibleEnd(text, width) {
  const visible = text.replace(/\x1b\[[0-9;]*m/g, "").length;
  return text + " ".repeat(Math.max(0, width - visible));
}

function formatSpeed(bytesPerSecond) {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) {
    return "0.0 KB/s";
  }

  const units = ["B/s", "KB/s", "MB/s", "GB/s"];
  let value = bytesPerSecond;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }

  const number = value >= 100 ? value.toFixed(0) : value.toFixed(1);
  return `${number} ${units[unit]}`;
}

function blueText(text) {
  return colorRgb(text, BANNER_GRADIENT_END);
}

function formatDownloadDetail(percent, bytesPerSecond) {
  const speed = blueText(formatSpeed(bytesPerSecond).padStart(STATUS_SPEED_WIDTH));
  return `${formatDownloadPercent(percent)} ${speed}`;
}

// A fixed checklist printed up front with every dot red. A dot only turns blue
// once its step has genuinely completed. The first row is the BE spoofer on/off
// status: blue when a BE loader has already run this Windows boot, red when it
// has not (e.g. right after a reboot). It flips to blue live if this run uses BE.
function createStatusBoard(options = {}) {
  const steps = [
    { key: "beStatus", label: "BE spoofer", done: Boolean(options.beUsed), detail: "" },
    ...STATUS_STEPS.map((step) => ({ ...step, done: false, detail: "" })),
  ];
  const useCursor = canMoveCursor();
  function lineFor(step) {
    const margin = contentMargin();
    const dotColumn = contentWidth() - 1;
    // Charcoal-metallic label; the live detail and dot keep their own colours.
    let preDot = `${" ".repeat(margin)}${charcoalGradient(`status: ${step.label}`)}`;
    if (step.detail) {
      preDot += ` ${step.detail}`;
    }
    return `${padVisibleEnd(preDot, margin + dotColumn)}${statusDot(step.done)}`;
  }

  function redraw() {
    if (!useCursor) {
      return;
    }

    process.stdout.write("\x1b[s");
    process.stdout.write(`\x1b[${STATUS_BOARD_TOP_ROW};1H`);
    steps.forEach((step, index) => {
      process.stdout.cursorTo(0);
      process.stdout.clearLine(0);
      process.stdout.write(`${lineFor(step)}\n`);
      for (let gap = 0; gap < STATUS_ROW_GAP && index < steps.length - 1; gap += 1) {
        process.stdout.cursorTo(0);
        process.stdout.clearLine(0);
        process.stdout.write("\n");
      }
    });
    process.stdout.write("\x1b[u");
  }

  function update(key, changes) {
    const step = steps.find((entry) => entry.key === key);
    if (!step) {
      return;
    }

    Object.assign(step, changes);

    if (useCursor) {
      redraw();
    } else if (changes.done) {
      console.log(lineFor(step));
    }
  }

  const api = {
    redraw,
    setDetail(key, detail) {
      update(key, { detail });
    },
    complete(key) {
      update(key, { done: true });
    },
  };

  activeStatusBoard = api;

  if (useCursor) {
    redraw();
  } else {
    steps.forEach((step, index) => {
      console.log(lineFor(step));
      for (let gap = 0; gap < STATUS_ROW_GAP && index < steps.length - 1; gap += 1) {
        console.log();
      }
    });
  }

  return api;
}

function formatDownloadPercent(percent) {
  const rounded = Math.round(clamp(percent, 0, 100));
  const amount = rounded / 100;
  const rgb = blendColor(BANNER_GRADIENT_START, BANNER_GRADIENT_END, amount);
  return colorRgb(`${String(rounded).padStart(3, " ")}%`, rgb);
}

function fileSize(filePath) {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

function averageSpeed(bytes, startedAt) {
  const seconds = Math.max((Date.now() - startedAt) / 1000, 0.001);
  return bytes / seconds;
}

async function waitForStableDownloadFile(filePath, options = {}) {
  const timeoutMs = options.timeoutMs || DOWNLOAD_RECOVERY_TIMEOUT_MS;
  const minMtimeMs = options.minMtimeMs || 0;
  const started = Date.now();
  let lastSize = -1;
  let stableTicks = 0;

  while (Date.now() - started < timeoutMs) {
    try {
      const stat = fs.statSync(filePath);
      if (stat.isFile() && stat.size > 0 && stat.mtimeMs >= minMtimeMs) {
        if (stat.size === lastSize) {
          stableTicks += 1;
        } else {
          stableTicks = 0;
          lastSize = stat.size;
        }

        if (stableTicks >= 2) {
          return filePath;
        }
      }
    } catch {
      // The browser may still be renaming the download into place.
    }

    await sleep(100);
  }

  return "";
}

async function findRecoveredDownload(suggestedName, startedAt, options = {}) {
  const timeoutMs = options.timeoutMs || DOWNLOAD_RECOVERY_TIMEOUT_MS;
  const targetPath = path.join(DOWNLOAD_DIR, suggestedName);
  const exactPath = await waitForStableDownloadFile(targetPath, {
    timeoutMs,
    minMtimeMs: startedAt - 1000,
  });
  if (exactPath) {
    return exactPath;
  }

  let candidates = [];
  try {
    candidates = fs
      .readdirSync(DOWNLOAD_DIR)
      .filter((name) => /\.exe$/i.test(name))
      .map((name) => path.join(DOWNLOAD_DIR, name))
      .filter((filePath) => fs.statSync(filePath).mtimeMs >= startedAt - 1000);
  } catch {
    return "";
  }

  if (candidates.length !== 1) {
    return "";
  }

  return waitForStableDownloadFile(candidates[0], {
    timeoutMs,
    minMtimeMs: startedAt - 1000,
  });
}

function estimateUnknownDownloadPercent(receivedBytes, startedAt) {
  if (receivedBytes <= 0) {
    return 0;
  }

  const elapsedSeconds = Math.max((Date.now() - startedAt) / 1000, 0);
  const byteProgress = Math.log2(receivedBytes / 65536 + 1) * 8;
  return Math.min(95, byteProgress + elapsedSeconds * 1.5);
}

function createEstimatedDownloadProgressTracker(board) {
  const startedAt = Date.now();
  let percent = 0;
  let stopped = false;

  const timer = setInterval(() => {
    percent = Math.min(95, percent + 1.25);
    board.setDetail("generate", formatDownloadDetail(percent, 0));
  }, STATUS_TICK_MS);

  return {
    finish(finalBytes = 0) {
      if (stopped) {
        return;
      }

      stopped = true;
      clearInterval(timer);
      board.setDetail("generate", formatDownloadDetail(100, averageSpeed(finalBytes, startedAt)));
    },
    stop() {
      if (stopped) {
        return;
      }

      stopped = true;
      clearInterval(timer);
    },
  };
}

function createBrowserDownloadProgressTracker(board, session) {
  let activeGuid = "";
  let startedAt = 0;
  let lastTime = 0;
  let lastBytes = 0;
  let receivedBytes = 0;
  let totalBytes = 0;
  let speed = 0;
  let completed = false;
  let cleaned = false;

  const cleanup = () => {
    if (cleaned) {
      return;
    }

    cleaned = true;
    session.off("Browser.downloadWillBegin", onDownloadWillBegin);
    session.off("Browser.downloadProgress", onDownloadProgress);
  };

  const ensureStarted = () => {
    if (startedAt) {
      return;
    }

    startedAt = Date.now();
    lastTime = startedAt;
    lastBytes = receivedBytes;
  };

  const paintProgress = (percent, bytesPerSecond) => {
    board.setDetail("generate", formatDownloadDetail(percent, bytesPerSecond));
  };

  const updateFromBytes = (nextReceivedBytes, nextTotalBytes, state) => {
    ensureStarted();

    receivedBytes = Math.max(receivedBytes, nextReceivedBytes);
    totalBytes = Math.max(totalBytes, nextTotalBytes);

    const now = Date.now();
    const seconds = (now - lastTime) / 1000;
    if (seconds > 0 && receivedBytes >= lastBytes) {
      speed = (receivedBytes - lastBytes) / seconds;
      lastBytes = receivedBytes;
      lastTime = now;
    }

    if (state === "completed") {
      completed = true;
      const finalBytes = Math.max(receivedBytes, totalBytes);
      paintProgress(100, averageSpeed(finalBytes, startedAt));
      cleanup();
      return;
    }

    if (state === "canceled") {
      cleanup();
      return;
    }

    const percent =
      totalBytes > 0
        ? Math.min(99, (receivedBytes / totalBytes) * 100)
        : estimateUnknownDownloadPercent(receivedBytes, startedAt);
    paintProgress(percent, speed);
  };

  function onDownloadWillBegin(event) {
    if (activeGuid) {
      return;
    }

    activeGuid = event.guid;
    receivedBytes = 0;
    totalBytes = 0;
    startedAt = Date.now();
    lastTime = startedAt;
    lastBytes = 0;
    speed = 0;
  }

  function onDownloadProgress(event) {
    if (!activeGuid) {
      activeGuid = event.guid;
    }

    if (event.guid !== activeGuid) {
      return;
    }

    updateFromBytes(
      Number(event.receivedBytes) || 0,
      Number(event.totalBytes) || 0,
      event.state
    );
  }

  session.on("Browser.downloadWillBegin", onDownloadWillBegin);
  session.on("Browser.downloadProgress", onDownloadProgress);

  return {
    finish(finalBytes = 0) {
      if (completed) {
        return;
      }

      ensureStarted();
      const bytes = Math.max(receivedBytes, totalBytes, finalBytes);
      completed = true;
      paintProgress(100, averageSpeed(bytes, startedAt));
      cleanup();
    },
    stop() {
      cleanup();
    },
  };
}

async function createDownloadProgressTracker(board, browser) {
  if (!browser || typeof browser.newBrowserCDPSession !== "function") {
    return createEstimatedDownloadProgressTracker(board);
  }

  try {
    const session = await browser.newBrowserCDPSession();
    await session.send("Browser.setDownloadBehavior", {
      behavior: "allow",
      downloadPath: DOWNLOAD_DIR,
      eventsEnabled: true,
    });
    return createBrowserDownloadProgressTracker(board, session);
  } catch {
    return createEstimatedDownloadProgressTracker(board);
  }
}

async function downloadLoader(board, browser, page, generateButton) {
  board.setDetail("generate", formatDownloadDetail(0, 0));

  const generate = generateButton || page.getByText(/generate loader/i).first();
  if (!generateButton) {
    await generate.waitFor({ state: "visible", timeout: GENERATE_TIMEOUT_MS });
  }

  const progress = await createDownloadProgressTracker(board, browser);
  try {
    const downloadStartedAt = Date.now();
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: DOWNLOAD_TIMEOUT_MS }),
      generate.click({ timeout: DEFAULT_TIMEOUT_MS }),
    ]);

    const suggested = path.basename(download.suggestedFilename() || "loader.exe");
    const targetPath = path.join(DOWNLOAD_DIR, suggested);
    const existingPath = await findRecoveredDownload(suggested, downloadStartedAt, {
      timeoutMs: 350,
    });
    if (existingPath) {
      progress.finish(fileSize(existingPath));
      return existingPath;
    }

    try {
      await download.saveAs(targetPath);
      progress.finish(fileSize(targetPath));
      return targetPath;
    } catch (err) {
      const recoveredPath = await findRecoveredDownload(suggested, downloadStartedAt);
      if (recoveredPath) {
        progress.finish(fileSize(recoveredPath));
        return recoveredPath;
      }

      throw err;
    }
  } finally {
    progress.stop();
  }
}

function cleanKeyTimeValue(value) {
  return value
    .replace(/\s+/g, " ")
    .replace(/\b(generate loader|continue|download|loader)\b.*$/i, "")
    .replace(/^(time\s*(?:left|remaining)|remaining\s*time|key\s*(?:time|expires?|expiry|expiration)|expires?\s*(?:in|on|at)|valid\s*(?:for|until)|duration)\s*[:\-]?\s*/i, "")
    .replace(/[|/\\_-]+$/g, "")
    .trim();
}

function scoreKeyTimeCandidate(value, hasContext) {
  const normalized = value.toLowerCase();
  const hasLargeUnit = /\b(years?|yrs?|y|months?|mos?|mo|weeks?|wks?|w|days?|d)\b/.test(normalized);
  const hasSmallUnit = /\b(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/.test(normalized);
  let score = hasContext ? 10 : 0;

  if (hasLargeUnit) {
    score += 100;
  }

  if (hasSmallUnit) {
    score += 25;
  }

  if (hasSmallUnit && !hasLargeUnit && !hasContext) {
    score -= 50;
  }

  if (CLOCK_PATTERN.test(normalized)) {
    score += hasContext ? 5 : -100;
  }
  CLOCK_PATTERN.lastIndex = 0;

  return score;
}

function addKeyTimeCandidate(candidates, value, hasContext) {
  const cleaned = cleanKeyTimeValue(value);

  if (!cleaned || /^(generate loader|continue|download|loader)$/i.test(cleaned)) {
    return;
  }

  candidates.push({
    value: cleaned,
    score: scoreKeyTimeCandidate(cleaned, hasContext),
  });
}

function parseKeyTimeLeft(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const candidates = [];

  for (const line of lines) {
    const hasContext = KEY_TIME_CONTEXT.test(line);
    KEY_TIME_CONTEXT.lastIndex = 0;
    DURATION_PATTERN.lastIndex = 0;

    for (const match of line.matchAll(DURATION_PATTERN)) {
      addKeyTimeCandidate(candidates, match[0], hasContext);
    }

    if (hasContext) {
      CLOCK_PATTERN.lastIndex = 0;
      for (const match of line.matchAll(CLOCK_PATTERN)) {
        addKeyTimeCandidate(candidates, match[0], true);
      }
    }
  }

  const compact = cleanKeyTimeValue(text);
  DURATION_PATTERN.lastIndex = 0;
  for (const match of compact.matchAll(DURATION_PATTERN)) {
    const before = compact.slice(Math.max(0, match.index - 50), match.index);
    const after = compact.slice(match.index + match[0].length, match.index + match[0].length + 50);
    const hasContext = KEY_TIME_CONTEXT.test(`${before} ${after}`);
    KEY_TIME_CONTEXT.lastIndex = 0;
    addKeyTimeCandidate(candidates, match[0], hasContext);
  }

  candidates.sort((a, b) => b.score - a.score || b.value.length - a.value.length);

  for (const candidate of candidates) {
    if (candidate.score > 0) {
      return candidate.value;
    }
  }

  return "";
}

async function readKeyTimeLeft(page) {
  const bodyText = await page
    .locator("body")
    .innerText({ timeout: KEY_TIME_READ_TIMEOUT_MS })
    .catch(() => "");
  return parseKeyTimeLeft(bodyText) || "not shown by site";
}

function startKeyTimeHeaderSync(page) {
  if (!canMoveCursor()) {
    readKeyTimeLeft(page)
      .then(updateHeaderKeyTime)
      .catch(() => {});
    return () => {};
  }

  let stopped = false;
  let timer = null;

  async function tick() {
    timer = null;
    if (stopped || !page || page.isClosed()) {
      return;
    }

    try {
      updateHeaderKeyTime(await readKeyTimeLeft(page));
    } catch {
      // A transient DOM/navigation miss should not kill the live timer.
    }

    if (!stopped && page && !page.isClosed()) {
      timer = setTimeout(tick, KEY_TIME_SYNC_MS);
    }
  }

  timer = setTimeout(tick, 0);

  return () => {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
}

function maskKey(key) {
  if (!key) {
    return "(no key)";
  }

  return key.length > 8 ? `${key.slice(0, 4)}...${key.slice(-4)}` : "(short key)";
}

async function clickContinueButton(page) {
  try {
    await page.getByRole("button", { name: /continue/i }).first().click({
      timeout: OPTIONAL_CONTINUE_TIMEOUT_MS,
    });
    return true;
  } catch {
    try {
      await page.getByText(/^continue$/i).first().click({
        timeout: OPTIONAL_CONTINUE_TEXT_TIMEOUT_MS,
      });
      return true;
    } catch {
      return false;
    }
  }
}

async function hasSerialField(keyField) {
  return (await keyField.count().catch(() => 0)) > 0;
}

async function fillKeyFieldFast(page, keyField, key) {
  try {
    await keyField.fill(key, { timeout: FAST_ACTION_TIMEOUT_MS });
    return true;
  } catch {
    // The server-rendered textarea can exist before Playwright considers it
    // fillable; set it directly and let the retry click submit once hydrated.
  }

  return page
    .evaluate((serial) => {
      const field = document.querySelector("#serialNumber");
      if (!field) {
        return false;
      }

      const descriptor = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(field),
        "value"
      );
      if (descriptor && descriptor.set) {
        descriptor.set.call(field, serial);
      } else {
        field.value = serial;
      }

      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }, key)
    .catch(() => false);
}

async function isContinueHydrated(page) {
  return page
    .evaluate(() => {
      const hasReactState = (element) =>
        Boolean(
          element &&
            Object.keys(element).some(
              (key) => key.startsWith("__reactProps$") || key.startsWith("__reactFiber$")
            )
        );
      const button = [...document.querySelectorAll("button")].find((candidate) =>
        /^continue$/i.test((candidate.textContent || "").trim())
      );
      const form = button ? button.closest("form") : document.querySelector("form");
      const field = document.querySelector("#serialNumber");
      return hasReactState(button) || hasReactState(form) || hasReactState(field);
    })
    .catch(() => false);
}

async function waitForGenerateAfterKey(page, keyField, generateButton, key) {
  const started = Date.now();
  let submitAttempts = 0;

  while (Date.now() - started < GENERATE_TIMEOUT_MS) {
    if (await generateButton.isVisible().catch(() => false)) {
      return;
    }

    const keyFieldReady = await hasSerialField(keyField);
    const continueVisible = await page
      .getByRole("button", { name: /continue/i })
      .first()
      .isVisible()
      .catch(() => false);
    const continueTextVisible = continueVisible
      ? true
      : await page
          .getByText(/^continue$/i)
          .first()
          .isVisible()
          .catch(() => false);

    if (keyFieldReady) {
      await fillKeyFieldFast(page, keyField, key);
      const canSubmit =
        continueVisible || continueTextVisible
          ? (await isContinueHydrated(page)) ||
            Date.now() - started >= HYDRATED_SUBMIT_FALLBACK_MS
          : false;
      if (canSubmit && (await clickContinueButton(page))) {
        submitAttempts += 1;
      }
      await page.waitForTimeout(KEY_SUBMIT_RETRY_MS);
      continue;
    }

    await page.waitForTimeout(100);
  }

  let message =
    "Generate Loader did not appear after submitting the key. Check keys.txt and try again.";
  if (submitAttempts > 1) {
    message += `\n\nThe page was still showing the serial-number form after ${submitAttempts} submit attempts.`;
  }
  try {
    const diagnostics = await writeFailureDiagnostics(page, key, "Generate Loader button was not visible after key submit.");
    message +=
      "\n\nSaved diagnostics so you can see what page the script reached:" +
      `\n- ${diagnostics.textPath}` +
      `\n- ${diagnostics.htmlPath}` +
      `\n- ${diagnostics.screenshotPath}`;
  } catch (diagnosticErr) {
    message += `\n\nCould not save diagnostics: ${diagnosticErr.message}`;
  }

  throw new FriendlyError(message);
}

async function chooseNativeExeType(page, exeType) {
  return page
    .evaluate((requestedType) => {
      const normalize = (value) =>
        String(value || "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, " ")
          .trim();
      const typeLabelPattern = /\btype\s+of\s+exe\b|\bexe\s+type\b|\bspoofer\s+type\b/i;
      const optionMatches = (value) => {
        const normalized = normalize(value);
        if (requestedType === "be") {
          return (
            normalized === "be" ||
            normalized === "before execution" ||
            /\bbe\b/.test(normalized) ||
            /\bbattleye\b|\bbattle eye\b/.test(normalized)
          );
        }
        return ["no", "none", "normal", "default"].includes(normalized) || /\bno\b/.test(normalized);
      };
      const isVisible = (element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      };
      const describeSelect = (select) => {
        const parts = [];
        if (select.id && window.CSS && CSS.escape) {
          const label = document.querySelector(`label[for="${CSS.escape(select.id)}"]`);
          if (label) {
            parts.push(label.textContent || "");
          }
        }
        const wrappingLabel = select.closest("label");
        if (wrappingLabel) {
          parts.push(wrappingLabel.textContent || "");
        }
        let parent = select.parentElement;
        for (let depth = 0; parent && depth < 3; depth += 1, parent = parent.parentElement) {
          parts.push(parent.textContent || "");
        }
        return normalize(parts.join(" "));
      };

      const candidates = [...document.querySelectorAll("select")]
        .filter(isVisible)
        .map((select) => {
          const optionText = [...select.options]
            .map((option) => `${option.textContent || ""} ${option.value || ""}`)
            .join(" ");
          const description = describeSelect(select);
          let score = 0;
          if (typeLabelPattern.test(description)) {
            score += 20;
          }
          if (typeLabelPattern.test(normalize(optionText))) {
            score += 5;
          }
          if ([...select.options].some((option) => optionMatches(`${option.textContent || ""} ${option.value || ""}`))) {
            score += 10;
          }
          return { select, score };
        })
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score);

      for (const { select } of candidates) {
        const option = [...select.options].find((candidate) =>
          optionMatches(`${candidate.textContent || ""} ${candidate.value || ""}`)
        );
        if (!option) {
          continue;
        }

        select.value = option.value;
        option.selected = true;
        select.dispatchEvent(new Event("input", { bubbles: true }));
        select.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }

      return false;
    }, exeType)
    .catch(() => false);
}

function exeTypeOptionPatterns(exeType) {
  return exeType === "be"
    ? [/\bBE\b/i, /BattlEye/i, /Battle Eye/i]
    : [/No Spoofer/i, /^No$/i, /\bNone\b/i, /\bDefault\b/i];
}

async function chooseComboboxExeType(page, exeType) {
  const combobox = page.getByRole("combobox").first();
  const comboboxCount = await combobox.count().catch(() => 0);
  if (!comboboxCount || !(await combobox.isVisible().catch(() => false))) {
    return false;
  }

  const patterns = exeTypeOptionPatterns(exeType);
  const currentText = await combobox.innerText({ timeout: FAST_ACTION_TIMEOUT_MS }).catch(() => "");
  if (patterns.some((pattern) => pattern.test(currentText))) {
    return true;
  }

  await combobox.click({ timeout: DEFAULT_TIMEOUT_MS });
  await page.waitForTimeout(150);

  for (const pattern of patterns) {
    const option = page.getByRole("option", { name: pattern }).first();
    if (await option.isVisible({ timeout: FAST_ACTION_TIMEOUT_MS }).catch(() => false)) {
      await option.click({ timeout: DEFAULT_TIMEOUT_MS });
      return true;
    }
  }

  for (const pattern of patterns) {
    const option = page.getByText(pattern).last();
    if (await option.isVisible({ timeout: FAST_ACTION_TIMEOUT_MS }).catch(() => false)) {
      await option.click({ timeout: DEFAULT_TIMEOUT_MS });
      return true;
    }
  }

  await page.keyboard.press("Escape").catch(() => {});
  return false;
}

async function clickExeTypeChoice(page, exeType) {
  return page
    .evaluate((requestedType) => {
      const normalize = (value) =>
        String(value || "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, " ")
          .trim();
      const typeLabelPattern = /\btype\s+of\s+exe\b|\bexe\s+type\b|\bspoofer\s+type\b/i;
      const optionMatches = (value) => {
        const normalized = normalize(value);
        if (requestedType === "be") {
          return (
            normalized === "be" ||
            normalized === "before execution" ||
            /\bbe\b/.test(normalized) ||
            /\bbattleye\b|\bbattle eye\b/.test(normalized)
          );
        }
        return ["no", "none", "normal", "default"].includes(normalized) || /\bno\b/.test(normalized);
      };
      const isVisible = (element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      };
      const elementText = (element) =>
        [
          element.textContent,
          element.getAttribute("aria-label"),
          element.getAttribute("title"),
          element.getAttribute("value"),
        ]
          .filter(Boolean)
          .join(" ");
      const nearestTypeRoot = () => {
        const labels = [...document.querySelectorAll("body *")].filter(
          (element) => isVisible(element) && typeLabelPattern.test(elementText(element))
        ).sort((a, b) => elementText(a).length - elementText(b).length);
        for (const label of labels) {
          let parent = label;
          for (let depth = 0; parent && depth < 5; depth += 1, parent = parent.parentElement) {
            const text = normalize(parent.textContent || "");
            if (text.includes("type of exe") || text.includes("exe type") || text.includes("spoofer type")) {
              return parent;
            }
          }
        }
        return document.body;
      };
      const clickFirstMatching = (root) => {
        const candidates = [
          ...root.querySelectorAll(
            "button,[role='button'],[role='option'],[role='radio'],[role='menuitem'],label,input[type='radio']"
          ),
        ].filter(isVisible);

        for (const candidate of candidates) {
          const text = elementText(candidate);
          const radioLabel =
            candidate.id && window.CSS && CSS.escape
              ? document.querySelector(`label[for="${CSS.escape(candidate.id)}"]`)
              : null;
          if (optionMatches(`${text} ${radioLabel ? radioLabel.textContent || "" : ""}`)) {
            candidate.click();
            candidate.dispatchEvent(new Event("input", { bubbles: true }));
            candidate.dispatchEvent(new Event("change", { bubbles: true }));
            return true;
          }
        }

        return false;
      };

      return clickFirstMatching(nearestTypeRoot()) || clickFirstMatching(document.body);
    }, exeType)
    .catch(() => false);
}

async function openExeTypeControl(page) {
  return page
    .evaluate(() => {
      const isVisible = (element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      };
      const textFor = (element) =>
        [element.textContent, element.getAttribute("aria-label"), element.getAttribute("title")]
          .filter(Boolean)
          .join(" ");
      const typeLabelPattern = /\btype\s+of\s+exe\b|\bexe\s+type\b|\bspoofer\s+type\b/i;
      const label = [...document.querySelectorAll("body *")]
        .filter((element) => isVisible(element) && typeLabelPattern.test(textFor(element)))
        .sort((a, b) => textFor(a).length - textFor(b).length)[0];
      if (!label) {
        return false;
      }

      for (let parent = label.parentElement; parent; parent = parent.parentElement) {
        const control = parent.querySelector("[role='combobox'],[aria-haspopup='listbox']");
        if (control && isVisible(control)) {
          control.click();
          return true;
        }
      }

      label.click();
      return true;
    })
    .catch(() => false);
}

async function chooseExeTypeOnWebsite(page, exeType, key) {
  if (await chooseComboboxExeType(page, exeType)) {
    if (SHOW_BROWSER) {
      await page.waitForTimeout(750);
    }
    return true;
  }

  if (await chooseNativeExeType(page, exeType)) {
    if (SHOW_BROWSER) {
      await page.waitForTimeout(750);
    }
    return true;
  }

  await openExeTypeControl(page);
  await page.waitForTimeout(100);
  if (await clickExeTypeChoice(page, exeType)) {
    if (SHOW_BROWSER) {
      await page.waitForTimeout(750);
    }
    return true;
  }

  if (exeType === EXE_TYPE_DEFAULT) {
    return false;
  }

  let message = "Could not select BE under Spoofer Type / Type of Exe before generating the launcher.";
  try {
    const diagnostics = await writeFailureDiagnostics(page, key, "Spoofer Type / Type of Exe BE option was not selectable.");
    message +=
      "\n\nSaved diagnostics so you can see what page the script reached:" +
      `\n- ${diagnostics.textPath}` +
      `\n- ${diagnostics.htmlPath}` +
      `\n- ${diagnostics.screenshotPath}`;
  } catch (diagnosticErr) {
    message += `\n\nCould not save diagnostics: ${diagnosticErr.message}`;
  }

  throw new FriendlyError(message);
}

// Read the one saved key from keys.txt.
function readCurrentKey() {
  if (!fs.existsSync(KEYS_FILE)) {
    return "";
  }

  const lines = fs
    .readFileSync(KEYS_FILE, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));

  for (const line of lines) {
    const key = normalizeEnteredKey(line);
    if (isValidKeyFormat(key)) {
      return key;
    }
  }

  return "";
}

function normalizeEnteredKey(key) {
  return String(key || "").replace(/^\*/, "").trim();
}

function cleanPastedKeyText(text) {
  const key = findKeyInText(text);
  if (key) {
    return key;
  }

  return normalizeEnteredKey(
    String(text || "")
      .replace(/\0/g, "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) || ""
  );
}

function isValidKeyFormat(key) {
  return KEY_PATTERN.test(normalizeEnteredKey(key));
}

// Pull a valid key out of arbitrary clipboard text: an exact key on any line,
// or a standalone 50-char run embedded in surrounding text.
function findKeyInText(text) {
  const cleaned = String(text || "").replace(/\0/g, "");

  for (const line of cleaned.split(/\r?\n/)) {
    const candidate = normalizeEnteredKey(line);
    if (isValidKeyFormat(candidate)) {
      return candidate;
    }
  }

  const match = cleaned.match(/(?:^|[^A-Za-z0-9])([A-Za-z0-9]{50})(?:[^A-Za-z0-9]|$)/);
  return match ? match[1] : "";
}

// PowerShell args that print the raw clipboard text as UTF-8. Reused by the
// synchronous (explicit paste) and asynchronous (background poll) readers.
const CLIPBOARD_READ_ARGS = [
  "-NoProfile",
  "-Command",
  "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; [Console]::Write((Get-Clipboard -Raw))",
];

function readClipboardText() {
  return readClipboardTextOnly();
}

function readClipboardTextOnly() {
  if (process.platform !== "win32") {
    return "";
  }

  try {
    return execFileSync("powershell.exe", CLIPBOARD_READ_ARGS, {
      encoding: "utf8",
      timeout: 2000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return "";
  }
}

// Non-blocking clipboard read for the background poll. Spawning PowerShell
// synchronously froze the key prompt for ~1s per poll (dead shimmer, buffered
// keystrokes); running it async keeps the event loop free while we wait.
function readClipboardTextAsync() {
  if (process.platform !== "win32") {
    return Promise.resolve("");
  }

  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      CLIPBOARD_READ_ARGS,
      { encoding: "utf8", timeout: 2000, windowsHide: true },
      (error, stdout) => {
        resolve(error || typeof stdout !== "string" ? "" : stdout);
      }
    );
  });
}

function saveCurrentKey(key) {
  const cleanKey = normalizeEnteredKey(key);
  fs.writeFileSync(KEYS_FILE, `${cleanKey}\r\n`);
}

function normalizeExeType(value) {
  const cleaned = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  if (["1", "be", "before execution", "beforeexecution"].includes(cleaned)) {
    return "be";
  }

  if (["2", "no", "none", "normal", "default"].includes(cleaned)) {
    return "no";
  }

  return "";
}

function formatExeType(exeType) {
  return exeType === "be" ? "BE" : "none";
}

function spooferChoicePrompt(currentType = "") {
  const current = currentType ? charcoalGradient(`  current: ${formatExeType(currentType)}`) : "";
  return [
    contentPad(),
    charcoalGradient("spoofer  "),
    colorRgb("[1]", BANNER_GRADIENT_END),
    charcoalGradient(" BE   "),
    colorRgb("[2]", BANNER_GRADIENT_END),
    charcoalGradient(" none"),
    current,
    charcoalGradient(": "),
  ].join("");
}

// Draw the fixed spoofer status line (which exe type this run will use) at its
// absolute layout row, clear the blank row beneath it, and land the cursor on
// the status board row so the checklist prints directly below. The spoofer type
// is chosen up front -- from the start prompt or the "Switch Spoofer Type" tool
// -- and never changes mid-run, so this line is informational only.
function spooferStatusLine(plan) {
  return `${contentPad()}${charcoalGradient("spoofer: ")}${colorRgb(
    formatExeType(plan.exeType),
    BANNER_GRADIENT_END
  )}`;
}

function printSpooferStatus(plan) {
  // The BE "already ran this boot" state is shown as a dot on the status board
  // now, so this line just reports the type this run will use.
  currentSpooferPlan = plan;
  const line = spooferStatusLine(plan);
  currentSpooferLine = line;

  if (canMoveCursor()) {
    // Clear every row between the key line and the status board (wiping any
    // leftover "choose spoofer" prompt), drawing the spoofer line in its slot.
    for (let row = CONTENT_ROW + 1; row < STATUS_BOARD_TOP_ROW; row += 1) {
      process.stdout.write(`\x1b[${row};1H`);
      process.stdout.clearLine(0);
      if (row === SPOOFER_ROW) {
        process.stdout.write(line);
      }
    }
    process.stdout.write(`\x1b[${STATUS_BOARD_TOP_ROW};1H`);
  } else {
    console.log(line);
    console.log();
  }
}

function keyStatusLine(key) {
  return `${contentPad()}${charcoalGradient(`key: ${maskKey(key)} (${key.length} chars)`)}`;
}

function printKeyStatus(key) {
  currentKeyValue = key;
  currentKeyLine = keyStatusLine(key);
  fitConsoleWindow(RUN_WINDOW_ROWS);

  if (canMoveCursor()) {
    redrawLayout();
    writeAbsoluteLine(CONTENT_ROW, currentKeyLine);
  } else {
    console.log(currentKeyLine);
  }
}

function readSavedExeType() {
  if (!fs.existsSync(EXE_TYPE_FILE)) {
    return "";
  }

  const lines = fs
    .readFileSync(EXE_TYPE_FILE, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const exeType = normalizeExeType(line);
    if (exeType) {
      return exeType;
    }
  }

  return "";
}

function saveExeType(exeType) {
  fs.writeFileSync(EXE_TYPE_FILE, `${normalizeExeType(exeType) || EXE_TYPE_DEFAULT}\r\n`);
}

function currentBootId() {
  const bootMs = Date.now() - os.uptime() * 1000;
  return String(Math.floor(bootMs / 60000));
}

function readExeTypeBootState() {
  try {
    const state = JSON.parse(fs.readFileSync(EXE_TYPE_BOOT_STATE_FILE, "utf8"));
    return state && typeof state === "object" ? state : {};
  } catch {
    return {};
  }
}

function saveExeTypeBootState(state) {
  fs.writeFileSync(EXE_TYPE_BOOT_STATE_FILE, `${JSON.stringify(state, null, 2)}\r\n`);
}

function hasUsedBeThisBoot(bootId) {
  return readExeTypeBootState().lastBeBootId === bootId;
}

function markBeUsedThisBoot(bootId) {
  const state = readExeTypeBootState();
  state.lastBeBootId = bootId;
  state.lastBeUsedAt = new Date().toISOString();
  saveExeTypeBootState(state);
}

function resolveExeTypePlan(defaultType, bootId = currentBootId()) {
  const normalizedDefault = normalizeExeType(defaultType) || EXE_TYPE_DEFAULT;
  const beUsedThisBoot = hasUsedBeThisBoot(bootId);
  const exeType = normalizedDefault === "be" && !beUsedThisBoot ? "be" : "no";

  return {
    bootId,
    defaultType: normalizedDefault,
    exeType,
    beUsedThisBoot,
  };
}

function askExeTypeKey(query, options = {}) {
  if (typeof process.stdin.setRawMode !== "function") {
    return options.timeoutMs ? Promise.resolve("") : askLine(query);
  }

  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    let finished = false;
    let timer = null;

    function finish(value, error) {
      if (finished) {
        return;
      }

      finished = true;
      if (timer) {
        clearTimeout(timer);
      }
      stdin.off("data", onData);
      stdin.setRawMode(Boolean(wasRaw));
      stdin.pause();
      if (query) {
        process.stdout.write("\n");
      }

      if (error) {
        reject(error);
      } else {
        resolve(value);
      }
    }

    function onData(buffer) {
      const text = buffer.toString("utf8");
      if (text.includes("\u0003")) {
        finish("", new FriendlyError("Exe type selection cancelled.", "cancelled"));
        return;
      }

      if (text.includes("\r") || text.includes("\n")) {
        finish("");
        return;
      }

      const key = text.replace(/\x1b\[[0-9;]*[A-Za-z~]/g, "").trim().charAt(0);
      if (key) {
        if (query) {
          process.stdout.write(key);
        }
        finish(key);
      }
    }

    if (query) {
      process.stdout.write(query);
    }
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
    if (options.timeoutMs) {
      timer = setTimeout(() => finish(""), options.timeoutMs);
    }
  });
}

async function promptForExeTypeDefault(currentType = "") {
  while (true) {
    console.log(contentPad() + bannerGradient(currentType ? "editing spoofer" : "choose spoofer"));
    const answer = await askExeTypeKey(spooferChoicePrompt(currentType));
    const exeType = normalizeExeType(answer);
    if (exeType) {
      saveExeType(exeType);
      return exeType;
    }

    console.log(contentPad() + color("Choose 1 for BE or 2 for none.", ANSI.red));
  }
}

async function promptForExeTypePlan() {
  let savedExeType = readSavedExeType();
  const bootId = currentBootId();

  if (!savedExeType) {
    savedExeType = process.stdin.isTTY && process.stdout.isTTY
      ? await promptForExeTypeDefault()
      : EXE_TYPE_DEFAULT;
  }

  return resolveExeTypePlan(savedExeType, bootId);
}

function askLine(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

function askKeyPaste() {
  if (typeof process.stdin.setRawMode !== "function") {
    return askLine("key: ");
  }

  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    const pad = contentPad();
    let value = "";
    let finished = false;
    let pasteTimer = null;
    let clipboardTimer = null;
    let pendingPasteText = "";
    let rejectingText = false;

    function clearPromptLine() {
      if (process.stdout.cursorTo && process.stdout.clearLine) {
        process.stdout.cursorTo(0);
        process.stdout.clearLine(0);
      } else {
        process.stdout.write("\r\x1b[2K");
      }
    }

    // Redraw the whole prompt line. The idle clipboard-watch state is blank; no
    // floating prompt star under COPY KEY.
    function renderPrompt() {
      if (!value) {
        clearPromptLine();
        return;
      }

      let line = `${pad}  `;
      for (let i = 0; i < value.length; i += 1) {
        line += maskStar(i);
      }

      if (process.stdout.cursorTo && process.stdout.clearLine) {
        process.stdout.cursorTo(0);
        process.stdout.clearLine(0);
        process.stdout.write(line);
      } else {
        process.stdout.write(`\r\x1b[2K${line}`);
      }
    }

    function finish(answer, error) {
      if (finished) {
        return;
      }

      finished = true;
      if (pasteTimer) {
        clearTimeout(pasteTimer);
      }
      if (clipboardTimer) {
        clearTimeout(clipboardTimer);
        clipboardTimer = null;
      }
      if (!error) {
        clearPromptLine();
      }
      stdin.off("data", onData);
      stdin.setRawMode(Boolean(wasRaw));
      stdin.pause();
      if (!canMoveCursor()) {
        process.stdout.write("\n");
      }

      if (error) {
        reject(error);
      } else {
        resolve({ value: answer });
      }
    }

    function acceptKey(candidate) {
      const key = normalizeEnteredKey(candidate);
      if (!isValidKeyFormat(key)) {
        return false;
      }

      value = key;
      finish(value);
      return true;
    }

    function rejectedFingerprint(text) {
      return String(text || "").replace(/\0/g, "").trim();
    }

    function rejectedStarCount(text) {
      const compactText = rejectedFingerprint(text).replace(/\s+/g, "");
      return Math.max(1, Math.min(KEY_LENGTH, compactText.length));
    }

    async function showRejectedText(text) {
      if (finished || rejectingText) {
        return;
      }

      const fingerprint = rejectedFingerprint(text);
      if (!fingerprint) {
        renderPrompt();
        return;
      }

      rejectingText = true;
      value = "";
      pendingPasteText = "";
      if (pasteTimer) {
        clearTimeout(pasteTimer);
        pasteTimer = null;
      }

      await animateStarsRetract(rejectedStarCount(text), {
        reject: true,
        shouldStop: () => finished,
      });

      rejectingText = false;
      if (!finished) {
        renderPrompt();
      }
    }

    function finishPastedText(text) {
      const rawText = String(text || "");

      const candidate = cleanPastedKeyText(text);
      if (acceptKey(candidate)) {
        return;
      }

      if (rawText.replace(/\0/g, "").trim()) {
        void showRejectedText(candidate || rawText);
      } else {
        renderPrompt();
      }
    }

    async function checkClipboardForKey() {
      if (finished) {
        return;
      }

      const clipboardText = await readClipboardTextAsync();
      if (finished) {
        return;
      }

      // A real key on the clipboard is accepted immediately -- even mid
      // rejection animation, and even if the clipboard has not "changed" since
      // the last read. This is what makes "copy the wrong thing, then copy the
      // real key" auto-fill the moment the real key lands on the clipboard.
      const key = findKeyInText(clipboardText);
      if (key) {
        acceptKey(key);
        return;
      }

      // Clipboard junk is ignored silently. Only a real key changes the screen.
    }

    // Poll one clipboard read at a time, scheduling the next only after the
    // current async read settles. This avoids stacking PowerShell spawns when a
    // read runs longer than the poll interval.
    function scheduleClipboardPoll() {
      if (finished) {
        return;
      }
      clipboardTimer = setTimeout(async () => {
        clipboardTimer = null;
        try {
          await checkClipboardForKey();
        } catch {
          // Never let a transient clipboard read or draw error kill the poll
          // loop -- a dead loop would silently stop auto-detecting the key for
          // the rest of the run, which looks like "nothing happens".
        } finally {
          scheduleClipboardPoll();
        }
      }, CLIPBOARD_POLL_MS);
    }

    function schedulePasteFinish(text) {
      if (rejectingText) {
        return;
      }

      pendingPasteText += text;
      if (pasteTimer) {
        clearTimeout(pasteTimer);
      }

      pasteTimer = setTimeout(() => {
        finishPastedText(pendingPasteText);
      }, PASTE_REJECT_DELAY_MS);
    }

    function eraseCharacter() {
      value = value.slice(0, -1);
    }

    function onData(buffer) {
      let text = buffer.toString("utf8");

      if (text.includes("\u0003")) {
        finish("", new FriendlyError("Key entry cancelled.", "no_key"));
        return;
      }

      if (rejectingText) {
        return;
      }

      text = text.replace(/\x1b\[200~([\s\S]*?)\x1b\[201~/g, (_match, pasted) => {
        finishPastedText(findKeyInText(pasted) || pasted);
        return "";
      });

      if (finished || rejectingText) {
        return;
      }

      if (text.includes("\u0016") || /\x1b\[(?:2|2;2)~/.test(text)) {
        finishPastedText(readClipboardText());
        return;
      }

      text = text.replace(/\x1b\[[0-9;]*[A-Za-z~]/g, "");
      const likelyPaste = text.replace(/[\r\n\b\u007f\u0015]/g, "").length > 1;

      if (likelyPaste) {
        schedulePasteFinish(text);
        return;
      }

      for (const char of text) {
        if (char === "\r" || char === "\n") {
          if (acceptKey(value)) {
            return;
          }

          if (value) {
            void showRejectedText(value);
          } else {
            renderPrompt();
          }
          return;
        }

        if (char === "\b" || char === "\u007f") {
          eraseCharacter();
          continue;
        }

        if (char === "\u0015") {
          while (value) {
            eraseCharacter();
          }
          continue;
        }

        if (/^[A-Za-z0-9]$/.test(char)) {
          value += char;
        }
      }

      if (isValidKeyFormat(value)) {
        finish(value);
        return;
      }

      renderPrompt();
    }

    renderPrompt();
    stdin.setRawMode(true);
    // Re-assert the lockdown after raw mode (which resets input flags). QuickEdit
    // stays off even here: the key still pastes via Ctrl+V and clipboard
    // auto-detect, so a stray click during entry can't freeze anything.
    configureConsole({ quickEdit: false, pinTopmost: false });
    stdin.resume();
    stdin.on("data", onData);
    // Kick off the first read immediately, then keep polling as each read
    // settles so an already-copied key is picked up right away.
    checkClipboardForKey().catch(() => {}).then(scheduleClipboardPoll);
  });
}

async function promptForKey() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new FriendlyError("No key found in keys.txt. Add a key before running the loader.", "no_key");
  }

  const cursorReady = canMoveCursor();

  // COPY KEY takes the reserved time zone (same size and spot as the key time
  // that replaces it later). The idle prompt line below stays blank.
  if (cursorReady) {
    drawTimeZone(centeredHeaderArtLines("COPY KEY"));
  } else {
    console.log(bannerGradient(makeHeaderPixelArt("COPY KEY")));
    console.log();
  }

  let key = "";
  let showedInvalid = false;

  while (!key) {
    if (cursorReady) {
      process.stdout.write(`\x1b[${PROMPT_WINDOW_ROWS};1H`);
      process.stdout.clearLine(0);
    }

    const entry = await askKeyPaste();
    const entered =
      entry && typeof entry === "object" && Object.prototype.hasOwnProperty.call(entry, "value")
        ? entry.value
        : entry;
    const candidate = cleanPastedKeyText(entered);

    if (isValidKeyFormat(candidate)) {
      key = candidate;
      break;
    }

    const message = color(`Invalid key. Paste a ${KEY_LENGTH}-character letters/numbers key.`, ANSI.red);
    if (cursorReady) {
      process.stdout.write(`\x1b[${PROMPT_WINDOW_ROWS};1H`);
      process.stdout.clearLine(0);
      process.stdout.write(contentPad() + message);
      showedInvalid = true;
    } else {
      console.log(message);
    }
  }

  if (cursorReady) {
    // Show the accepted key length as the blue retracting snake, then expand
    // into the full run layout.
    process.stdout.write(`\x1b[${PROMPT_WINDOW_ROWS};1H`);
    await animateStarsRetract(key.length);
    drawTimeZone(null);
    if (showedInvalid) {
      process.stdout.write(`\x1b[${PROMPT_WINDOW_ROWS};1H`);
      process.stdout.clearLine(0);
    }
    process.stdout.write(`\x1b[${PROMPT_WINDOW_ROWS};1H`);
    process.stdout.clearLine(0);
  }

  saveCurrentKey(key);
  return key;
}

async function getKeyToUse(cliKey) {
  const commandLineKey = normalizeEnteredKey(cliKey);
  if (commandLineKey) {
    if (!isValidKeyFormat(commandLineKey)) {
      throw new FriendlyError(`Invalid key. Expected ${KEY_LENGTH} letters/numbers.`, "invalid_key");
    }
    return commandLineKey;
  }

  const savedKey = readCurrentKey();
  return savedKey || promptForKey();
}

function runDownloaded(savePath) {
  if (!RUN_DOWNLOADED) {
    return false;
  }

  if (path.extname(savePath).toLowerCase() !== ".exe") {
    console.log(color("\nNot running: the download is not an .exe file.", ANSI.red));
    return false;
  }

  // Launch it through the Windows shell (like a double-click) instead of
  // spawning the path directly. A direct spawn() of a just-downloaded .exe can
  // fail with EACCES while security software is still scanning/locking the new
  // file, so we hand it to cmd's "start", which uses ShellExecute.
  const shell = process.env.ComSpec || "cmd.exe";
  const child = spawn(shell, ["/c", "start", "", savePath], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.on("error", (err) => {
    console.error(`\nCould not launch the loader: ${err.message}`);
  });
  child.unref();
  return true;
}

// Console hardening for Windows. We keep QuickEdit OFF the whole run so an
// accidental click, drag, or right-click can never put the console into
// selection mode (which freezes the program) or paste stray text into it. We
// also drop ENABLE_MOUSE_INPUT so mouse events are ignored entirely. Key entry
// stays fully usable without QuickEdit: pasting works through the Ctrl+V
// handler and the clipboard auto-detect, neither of which needs it.
// Best-effort and silent: if any of it fails we just keep going.
function buildConsoleScript(quickEdit, pinTopmost) {
  const quickEditValue = quickEdit ? "1" : "0";
  const topmostValue = pinTopmost ? "1" : "0";
  // Input flags: 0x80 EXTENDED, 0x40 QUICK_EDIT, 0x20 INSERT,
  // 0x10 MOUSE_INPUT, 0x08 WINDOW_INPUT. Apply through both STDIN and CONIN$:
  // different Windows hosts can expose one more reliably than the other.
  return `$quickEdit = ${quickEditValue}; $topmost = ${topmostValue}; $s = @'
[DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr CreateFile(string n, uint a, uint sh, IntPtr t, uint c, uint f, IntPtr hh);
[DllImport("kernel32.dll")] public static extern IntPtr GetStdHandle(int n);
[DllImport("kernel32.dll")] public static extern bool GetConsoleMode(IntPtr h, out uint m);
[DllImport("kernel32.dll")] public static extern bool SetConsoleMode(IntPtr h, uint m);
[DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
[DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int w, int z, uint f);
'@; try { New-Item -Path 'HKCU:\\Console\\linear.pub' -Force | Out-Null; New-ItemProperty -Path 'HKCU:\\Console\\linear.pub' -Name QuickEdit -PropertyType DWord -Value 0 -Force | Out-Null } catch {}; $k = Add-Type -MemberDefinition $s -Name ConsoleTweaks -Namespace ConIO -PassThru; $handles = @($k::GetStdHandle(-10), $k::CreateFile('CONIN$', [uint32]3221225472, 3, [IntPtr]::Zero, 3, 0, [IntPtr]::Zero)); foreach ($h in $handles) { if ($h -eq [IntPtr]::Zero -or $h -eq [IntPtr](-1)) { continue }; $m = 0; if ($k::GetConsoleMode($h, [ref]$m)) { $m = $m -bor 0x80; if ($quickEdit) { $m = $m -bor 0x40 } else { $m = $m -band (-bnot 0x40); $m = $m -band (-bnot 0x20); $m = $m -band (-bnot 0x10); $m = $m -band (-bnot 0x08) }; [void]$k::SetConsoleMode($h, $m) } }; if ($topmost) { [void]$k::SetWindowPos($k::GetConsoleWindow(), [IntPtr](-1), 0, 0, 0, 0, [uint32]0x0003) }`;
}

function configureConsole(options = {}) {
  if (process.platform !== "win32") {
    return;
  }

  const script = buildConsoleScript(options.quickEdit !== false, options.pinTopmost !== false);
  try {
    execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { timeout: 5000, windowsHide: true, stdio: "ignore" }
    );
  } catch {
    // The window stays click-sensitive / normal z-order; the run still works.
  }
}

// Same lockdown, fired without blocking. Used at startup so the console is
// hardened almost immediately without adding ~1s to the launch.
function configureConsoleAsync(options = {}) {
  if (process.platform !== "win32") {
    return;
  }

  const script = buildConsoleScript(options.quickEdit !== false, options.pinTopmost !== false);
  try {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { timeout: 5000, windowsHide: true, stdio: "ignore" },
      () => {}
    );
  } catch {
    // Best-effort; the synchronous locks at key entry / automation still apply.
  }
}

// Empty out the downloads folder so old loaders don't pile up run after run.
// A loader that is still running keeps its file locked - those are skipped and
// cleaned up on a later run instead.
function cleanDownloadsDir() {
  let names = [];
  try {
    names = fs.readdirSync(DOWNLOAD_DIR);
  } catch {
    return;
  }

  for (const name of names) {
    try {
      fs.unlinkSync(path.join(DOWNLOAD_DIR, name));
    } catch {
      // Locked or in use - leave it for next time.
    }
  }
}

// Mark the loader as running by writing our PID. "Switch Spoofer Type" reads
// this and refuses to open while the loader is live, so the two can't fight over
// exe-type.txt at the same time.
function writeLoaderLock() {
  try {
    fs.writeFileSync(LOADER_LOCK_FILE, `${process.pid}\r\n${new Date().toISOString()}\r\n`);
  } catch {
    // Best-effort: if we can't write the lock, the loader still runs fine.
  }
}

function removeLoaderLock() {
  try {
    fs.unlinkSync(LOADER_LOCK_FILE);
  } catch {
    // Already gone (or never written) - nothing to do.
  }
}

// A dropped/absent connection surfaces as one of these. We keep retrying on
// these (the internet may come back); anything else is a real failure.
function isNetworkError(err) {
  const message = String((err && err.message) || err || "");
  return /net::ERR_|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_NAME_RESOLUTION|ERR_CONNECTION|ERR_TIMED_OUT|ERR_NETWORK|ERR_ADDRESS_UNREACHABLE|ERR_PROXY|NS_ERROR_|Timeout \d+ms exceeded|timed out/i.test(
    message
  );
}

// Navigate to the site, but survive "browser opened before the internet was
// ready". Each attempt is short, so the moment the connection returns the next
// attempt lands the page. Non-network failures are thrown straight away.
async function gotoWithRetry(page, url, board) {
  const deadline = Date.now() + NAV_TOTAL_TIMEOUT_MS;
  let waited = false;

  while (true) {
    try {
      await page.goto(url, { waitUntil: "commit", timeout: NAV_ATTEMPT_TIMEOUT_MS });
      if (waited && board) {
        board.setDetail("access", "");
      }
      return;
    } catch (err) {
      if (!isNetworkError(err) || Date.now() >= deadline) {
        if (isNetworkError(err)) {
          throw new FriendlyError(
            "Could not reach launcher.linear.pub. Check your internet connection, then open Get Loader.bat again.",
            "no_network"
          );
        }
        throw err;
      }

      waited = true;
      if (board) {
        board.setDetail("access", colorRgb("waiting for internet", BANNER_GRADIENT_END));
      }
      await sleep(NAV_RETRY_DELAY_MS);
    }
  }
}

async function main() {
  // Claim the run lock first thing so the switcher stays blocked for the whole
  // run; it's cleared on exit by the process "exit" handler below.
  writeLoaderLock();

  // Harden the console before anything interactive is shown, so mouse drags
  // cannot put the window into Select mode while the key is being captured.
  configureConsole({ quickEdit: false, pinTopmost: false });
  startConsoleLockWatchdog();

  printStartupBanner();

  const cliKey = process.argv[2];
  const key = await getKeyToUse(cliKey);

  printKeyStatus(key);

  if (!key) {
    throw new FriendlyError("No key found in keys.txt. Add a key before running the loader.", "no_key");
  }

  const exeTypePlan = await promptForExeTypePlan();
  printSpooferStatus(exeTypePlan);

  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
  cleanDownloadsDir();

  // Show the whole checklist up front (every dot red); each dot turns blue as
  // its step actually finishes. The BE row starts blue if BE already ran this
  // boot.
  const board = createStatusBoard({ beUsed: exeTypePlan.beUsedThisBoot });

  let browser;
  let page;
  let closeBrowserPromise = null;
  let stopKeyTimeSync = () => {};

  try {
    // By default the browser runs hidden in the background. Set
    // LINEAR_SHOW_BROWSER=1 before running to watch it work.
    const automationPromise = createAutomationPage({ acceptDownloads: true });
    // Re-assert the lockdown (key entry toggled raw mode) and pin the window on
    // top for the automation phase. Runs while the browser launches, so it costs
    // no extra wall-clock time.
    configureConsole({ quickEdit: false });
    const automation = await automationPromise;
    browser = automation.browser;
    activeBrowser = browser;
    page = automation.page;
    const keyField = page.locator("#serialNumber");

    await gotoWithRetry(page, SITE_URL, board);
    board.complete("access");

    const generateButton = page.getByText(/generate loader/i).first();
    await waitForGenerateAfterKey(page, keyField, generateButton, key);
    board.complete("enterKey");
    stopKeyTimeSync = startKeyTimeHeaderSync(page);
    const exeType = exeTypePlan.exeType;
    await chooseExeTypeOnWebsite(page, exeType, key);

    // 3) Click "Generate Loader" and capture the download it triggers.
    const savePath = await downloadLoader(board, browser, page, generateButton);
    if (exeType === "be") {
      markBeUsedThisBoot(exeTypePlan.bootId);
      board.complete("beStatus");
    }
    board.complete("generate");

    if (!SHOW_BROWSER) {
      stopKeyTimeSync();
      closeBrowserPromise = trackBrowserClose(browser);
    }

    const launched = runDownloaded(savePath);
    if (launched) {
      board.complete("run");
    }

    if (!launched && !RUN_DOWNLOADED) {
      console.log(color("\nThe file was saved, but LINEAR_NO_RUN is set so it was not launched.", ANSI.red));
    } else if (!launched) {
      console.log(
        color("\nThe file was saved but is not an .exe, so it was not run.", ANSI.red)
      );
      process.exitCode = 1;
    }

    if (SHOW_BROWSER) {
      await waitForVisibleBrowserClose(browser, page);
      stopKeyTimeSync();
    } else {
      await closeBrowserPromise;
    }
    if (activeBrowser === browser) {
      activeBrowser = null;
    }
  } catch (err) {
    if (SHOW_BROWSER && page && !page.isClosed()) {
      await waitForVisibleBrowserClose(browser, page).catch(() => {});
      stopKeyTimeSync();
    } else {
      stopKeyTimeSync();
    }

    if (closeBrowserPromise) {
      await closeBrowserPromise;
    } else {
      await trackBrowserClose(browser);
    }
    throw err;
  }
}

function showCursor() {
  if (process.stdout.isTTY) {
    process.stdout.write("\x1b[?25h");
  }
}

// Hard-exit, but let stdout drain first so the final status redraw (all dots
// blue) and the "finished" line are never truncated by the immediate exit. A
// short fallback guarantees we still exit promptly if the drain never fires.
function exitAfterFlush(code) {
  showCursor();
  let exited = false;
  const done = () => {
    if (!exited) {
      exited = true;
      process.exit(code);
    }
  };
  process.stdout.write("", done);
  setTimeout(done, 250).unref();
}

installCancellationHandlers();
installResizeHandler();
// Clear the run lock however we exit -- normal finish, error, or Ctrl+C (which
// routes through process.exit) all fire "exit", and unlink is safe if it's gone.
process.on("exit", removeLoaderLock);

// Last-resort safety net: if anything unexpected throws or rejects outside the
// normal flow, still close the browser and drop the lock instead of leaving an
// orphaned Chromium or a stale lock behind.
for (const event of ["uncaughtException", "unhandledRejection"]) {
  process.on(event, (err) => {
    if (cancellationStarted) {
      return;
    }
    cancellationStarted = true;
    showCursor();
    try {
      if (process.stdout.isTTY) {
        process.stdout.write(`\n${color("unexpected error, closing safely...", ANSI.red)}\n`);
      }
    } catch {
      // Ignore a failed write during teardown.
    }
    Promise.resolve(closeBrowserQuietly(activeBrowser)).finally(() => process.exit(1));
  });
}

main()
  .then(() => {
    // Force the process to close once everything is done, even if the browser
    // or a detached handle would otherwise keep it alive.
    exitAfterFlush(process.exitCode || 0);
  })
  .catch((err) => {
    console.error("\nSomething went wrong:");
    console.error(err && err.message ? err.message : err);
    if (!err || !err.isFriendly) {
      console.error(
        "\nTip: the site's buttons may use different text/markup than this script expects.\n" +
          "Run with LINEAR_SHOW_BROWSER=1 to watch it run and see where it stopped,\n" +
          "then adjust the selectors near the numbered steps in get-loader.js."
      );
    }
    exitAfterFlush(1);
  });
