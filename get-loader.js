// get-loader.js
//
// Automates entering your key on launcher.linear.pub and downloading the loader.
// It launches the downloaded loader automatically after saving it.
//
// Usage:
//   node get-loader.js            -> uses the "current" key from keys.txt
//   node get-loader.js MYKEY123   -> uses the key you pass on the command line

const fs = require("fs");
const path = require("path");
const { execFileSync, spawn } = require("child_process");
const readline = require("readline");
const { chromium } = require("playwright");

const SITE_URL = "https://launcher.linear.pub/";
const KEYS_FILE = path.join(__dirname, "keys.txt");
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
const KEY_TIME_READ_TIMEOUT_MS = 250;
const STATUS_TICK_MS = 120;
const PROMPT_SHIMMER_TICK_MS = 90;
const SUCCESS_EXIT_SECONDS = 0;
const BLOCKED_RESOURCE_TYPES = new Set(["image", "font", "media"]);
const KEY_LENGTH = 50;
const KEY_PATTERN = /^[A-Za-z0-9]{50}$/;
const PASTE_REJECT_DELAY_MS = 180;
const CLIPBOARD_POLL_MS = 300;

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
const HEADER_PIXEL_ON = "██";
const HEADER_PIXEL_OFF = "  ";
const HEADER_PIXEL_GAP = " ";
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
  M: ["101", "111", "111", "101", "101"],
  O: ["111", "101", "101", "101", "111"],
  P: ["111", "101", "111", "100", "100"],
  Y: ["101", "101", "010", "010", "010"],
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
// 1 starts the next block immediately after LINEAR.PUB; 3 leaves two blank rows.
const AFTER_LINEAR_GAP = 3;
const TIME_HEIGHT = HEADER_PIXEL_HEIGHT;
const TIME_ROW = TOP_GAP + LINEAR_HEIGHT + AFTER_LINEAR_GAP;
const CONTENT_ROW = TIME_ROW + TIME_HEIGHT + 1;
const DEFAULT_TERM_COLUMNS = 82;

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

  const pad = contentPad();
  const starCount = Math.max(1, Math.min(KEY_LENGTH, Math.trunc(count) || 0));
  const promptStar = options.reject ? rejectShimmerStar : shimmerStar;
  const rowStar = options.reject ? rejectMaskStar : maskStar;

  for (let remaining = starCount; remaining > 0; remaining -= 3) {
    let line = `${pad}${promptStar(remaining)} `;
    for (let i = 0; i < remaining; i += 1) {
      line += rowStar(i, starCount);
    }
    process.stdout.cursorTo(0);
    process.stdout.clearLine(0);
    process.stdout.write(line);
    await sleep(18);
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

function printStartupBanner() {
  // Clear and home so the fixed-row layout below always anchors to the top,
  // and hide the hardware cursor so it can't blink around while we redraw.
  if (process.stdout.isTTY) {
    process.stdout.write("\x1b[2J\x1b[H\x1b[?25l");
  }

  process.stdout.write("\n".repeat(TOP_GAP)); // small gap from the top edge
  console.log(centerArt(LINEAR_ART, linearPubBanner()));
  // Leave the time zone blank (it fills in once the key time is known) and
  // land the cursor on the content row.
  process.stdout.write("\n".repeat(CONTENT_ROW - (TOP_GAP + LINEAR_HEIGHT + 1)));
}

async function printFinishedBanner() {
  console.log();
  const pad = contentPad();

  if (SUCCESS_EXIT_SECONDS <= 0) {
    writeStatusLine(pad + bannerGradient("finished, closing now"), true);
    return;
  }

  for (let remaining = SUCCESS_EXIT_SECONDS; remaining > 0; remaining -= 1) {
    writeStatusLine(pad + bannerGradient(`finished, closing in ${remaining} seconds`));
    await sleep(1000);
  }

  writeStatusLine(pad + bannerGradient("finished, closing now"), true);
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

function writeStatusLine(line, newline = false) {
  if (process.stdout.isTTY && process.stdout.clearLine && process.stdout.cursorTo) {
    process.stdout.clearLine(0);
    process.stdout.cursorTo(0);
    process.stdout.write(line);
    if (newline) {
      process.stdout.write("\n");
    }
    return;
  }

  console.log(line);
}

function canMoveCursor() {
  return (
    process.stdout.isTTY &&
    process.stdout.clearLine &&
    process.stdout.cursorTo &&
    process.stdout.moveCursor
  );
}

// Pull days / hours / minutes out of the site's time string.
function extractDHM(text) {
  if (!text || typeof text !== "string") {
    return null;
  }

  const days = text.match(/(\d+)\s*d(?:ay)?s?\b/i);
  const hours = text.match(/(\d+)\s*h(?:ou)?r?s?\b/i);
  const minutes = text.match(/(\d+)\s*m(?:in)?(?:ute)?s?\b/i);

  if (!days && !hours && !minutes) {
    return null;
  }

  return {
    d: days ? days[1] : "0",
    h: hours ? hours[1] : "0",
    m: minutes ? minutes[1] : "0",
  };
}

// Fill the reserved time zone with a block of small art (or clear it).
function drawTimeZone(lines) {
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

// Show the key time as banner art ("17D 20H 30M"). Until the site reports a
// parsable time, the zone simply stays empty - no placeholder dashes.
function updateHeaderKeyTime(timeLeft) {
  const dhm = extractDHM(timeLeft);
  if (!dhm) {
    return;
  }

  drawTimeZone(centeredHeaderArtLines(`${dhm.d}D ${dhm.h}H ${dhm.m}M`));
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
// once its step has genuinely completed.
function createStatusBoard() {
  const steps = STATUS_STEPS.map((step) => ({ ...step, done: false, detail: "" }));
  const useCursor = canMoveCursor();
  const margin = contentMargin();
  const dotColumn = contentWidth() - 1;
  const boardHeight = steps.length + STATUS_ROW_GAP * Math.max(0, steps.length - 1);

  function lineFor(step) {
    // Charcoal-metallic label; the live detail and dot keep their own colours.
    let preDot = `${" ".repeat(margin)}${charcoalGradient(`status: ${step.label}`)}`;
    if (step.detail) {
      preDot += ` ${step.detail}`;
    }
    return `${padVisibleEnd(preDot, margin + dotColumn)}${statusDot(step.done)}`;
  }

  function redraw() {
    process.stdout.write(`\x1b[${boardHeight}A`);
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

  steps.forEach((step, index) => {
    console.log(lineFor(step));
    for (let gap = 0; gap < STATUS_ROW_GAP && index < steps.length - 1; gap += 1) {
      console.log();
    }
  });

  return {
    setDetail(key, detail) {
      update(key, { detail });
    },
    complete(key) {
      update(key, { done: true });
    },
  };
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

function readClipboardText() {
  return readClipboardSnapshot().text;
}

function readClipboardTextOnly() {
  if (process.platform !== "win32") {
    return "";
  }

  try {
    return execFileSync(
      "powershell.exe",
      ["-NoProfile", "-Command", "Get-Clipboard -Raw"],
      {
        encoding: "utf8",
        timeout: 2000,
        windowsHide: true,
        stdio: ["ignore", "pipe", "ignore"],
      }
    );
  } catch {
    return "";
  }
}

function readClipboardSnapshot() {
  if (process.platform !== "win32") {
    return { text: "", sequence: 0 };
  }

  try {
    const output = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        "$sig='[DllImport(\"user32.dll\")] public static extern uint GetClipboardSequenceNumber();'; " +
          "$native=Add-Type -MemberDefinition $sig -Name ClipboardSequence -Namespace Win32 -PassThru; " +
          "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; " +
          "[Console]::WriteLine($native::GetClipboardSequenceNumber()); " +
          "[Console]::Write((Get-Clipboard -Raw))",
      ],
      {
        encoding: "utf8",
        timeout: 2000,
        windowsHide: true,
        stdio: ["ignore", "pipe", "ignore"],
      }
    );
    const firstBreak = output.indexOf("\n");
    if (firstBreak === -1) {
      return { text: "", sequence: Number(output.trim()) || 0 };
    }

    return {
      text: output.slice(firstBreak + 1),
      sequence: Number(output.slice(0, firstBreak).trim()) || 0,
    };
  } catch {
    return { text: readClipboardTextOnly(), sequence: 0 };
  }
}

function saveCurrentKey(key) {
  const cleanKey = normalizeEnteredKey(key);
  fs.writeFileSync(KEYS_FILE, `${cleanKey}\r\n`);
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
    return askLine(`${shimmerStar(0)} `);
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
    let shimmerFrame = 0;
    let rejectingText = false;
    let promptRejected = false;
    let lastClipboardSequence = 0;
    let lastClipboardFingerprint = "";

    // Redraw the whole prompt line: the prompt "*" stays red after a rejection,
    // while entered characters keep the blue key gradient.
    function renderPrompt() {
      const promptStar = promptRejected ? rejectShimmerStar : shimmerStar;
      let line = `${pad}${promptStar(shimmerFrame)} `;
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

    const shimmerTimer = setInterval(() => {
      if (finished || rejectingText) {
        return;
      }
      shimmerFrame += 1;
      renderPrompt();
    }, PROMPT_SHIMMER_TICK_MS);

    function finish(answer, error) {
      if (finished) {
        return;
      }

      finished = true;
      clearInterval(shimmerTimer);
      if (pasteTimer) {
        clearTimeout(pasteTimer);
      }
      if (clipboardTimer) {
        clearInterval(clipboardTimer);
      }
      if (!error) {
        renderPrompt();
      }
      stdin.off("data", onData);
      stdin.setRawMode(Boolean(wasRaw));
      stdin.pause();
      process.stdout.write("\n");

      if (error) {
        reject(error);
      } else {
        resolve({ value: answer, promptRejected });
      }
    }

    function acceptKey(candidate) {
      const key = normalizeEnteredKey(candidate);
      if (!isValidKeyFormat(key)) {
        return false;
      }

      promptRejected = false;
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

      promptRejected = true;
      rejectingText = true;
      value = "";
      pendingPasteText = "";
      if (pasteTimer) {
        clearTimeout(pasteTimer);
        pasteTimer = null;
      }

      await animateStarsRetract(rejectedStarCount(text), { reject: true });

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

    function checkClipboardForKey() {
      if (finished || rejectingText) {
        return;
      }

      const snapshot = readClipboardSnapshot();
      const clipboardText = snapshot.text;
      const clipboardFingerprint = rejectedFingerprint(clipboardText);
      if (!clipboardFingerprint) {
        return;
      }

      if (snapshot.sequence) {
        if (snapshot.sequence === lastClipboardSequence) {
          return;
        }
        lastClipboardSequence = snapshot.sequence;
      } else if (clipboardFingerprint === lastClipboardFingerprint) {
        return;
      } else {
        lastClipboardFingerprint = clipboardFingerprint;
      }

      const key = findKeyInText(clipboardText);
      if (key) {
        acceptKey(key);
        return;
      }

      if (!value) {
        void showRejectedText(clipboardText);
      }
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
    configureConsole({ quickEdit: true, pinTopmost: false });
    stdin.resume();
    stdin.on("data", onData);
    clipboardTimer = setInterval(checkClipboardForKey, CLIPBOARD_POLL_MS);
    checkClipboardForKey();
  });
}

async function promptForKey() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new FriendlyError("No key found in keys.txt. Add a key before running the loader.", "no_key");
  }

  const cursorReady = canMoveCursor();

  // COPY KEY takes the reserved time zone (same size and spot as the key time
  // that replaces it later); the prompt sits on the content row below.
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
      process.stdout.write(`\x1b[${CONTENT_ROW};1H`);
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
      process.stdout.write(`\x1b[${CONTENT_ROW + 1};1H`);
      process.stdout.clearLine(0);
      process.stdout.write(contentPad() + message);
      showedInvalid = true;
    } else {
      console.log(message);
    }
  }

  if (cursorReady) {
    // COPY KEY vanishes instantly, then the stars worm back into the prompt
    // right where the "key:" line will sit.
    drawTimeZone(null);
    if (showedInvalid) {
      process.stdout.write(`\x1b[${CONTENT_ROW + 1};1H`);
      process.stdout.clearLine(0);
    }
    process.stdout.write(`\x1b[${CONTENT_ROW};1H`);
    await animateStarsRetract(key.length);
    process.stdout.write(`\x1b[${CONTENT_ROW};1H`);
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

// Console hardening for Windows. During key entry, QuickEdit is kept on so
// right-click paste works. During browser automation, QuickEdit is turned off
// so an accidental click cannot freeze the console output.
// Best-effort and silent: if any of it fails we just keep going.
function configureConsole(options = {}) {
  if (process.platform !== "win32") {
    return;
  }

  const quickEdit = options.quickEdit !== false;
  const pinTopmost = options.pinTopmost !== false;
  const quickEditValue = quickEdit ? "1" : "0";
  const topmostValue = pinTopmost ? "1" : "0";
  const script = `$quickEdit = ${quickEditValue}; $topmost = ${topmostValue}; $s = '[DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr CreateFile(string n, uint a, uint sh, IntPtr t, uint c, uint f, IntPtr hh); [DllImport("kernel32.dll")] public static extern bool GetConsoleMode(IntPtr h, out uint m); [DllImport("kernel32.dll")] public static extern bool SetConsoleMode(IntPtr h, uint m); [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow(); [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int w, int z, uint f);'; $k = Add-Type -MemberDefinition $s -Name ConsoleTweaks -Namespace ConIO -PassThru; $h = $k::CreateFile('CONIN$', [uint32]3221225472, 3, [IntPtr]::Zero, 3, 0, [IntPtr]::Zero); $m = 0; [void]$k::GetConsoleMode($h, [ref]$m); if ($quickEdit) { $m = (($m -bor 0x80) -bor 0x40) } else { $m = (($m -bor 0x80) -band (-bnot 0x40)) }; [void]$k::SetConsoleMode($h, $m); if ($topmost) { [void]$k::SetWindowPos($k::GetConsoleWindow(), [IntPtr](-1), 0, 0, 0, 0, [uint32]0x0003) }`;

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

async function main() {
  printStartupBanner();

  const cliKey = process.argv[2];
  const key = await getKeyToUse(cliKey);

  console.log(contentPad() + charcoalGradient(`key: ${maskKey(key)} (${key.length} chars)`));

  if (!key) {
    throw new FriendlyError("No key found in keys.txt. Add a key before running the loader.", "no_key");
  }

  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
  cleanDownloadsDir();

  // Show the whole checklist up front (every dot red); each dot turns blue as
  // its step actually finishes.
  const board = createStatusBoard();

  let browser;
  let closeBrowserPromise = null;

  try {
    // By default the browser runs hidden in the background. Set
    // LINEAR_SHOW_BROWSER=1 before running to watch it work.
    const automationPromise = createAutomationPage({ acceptDownloads: true });
    configureConsole({ quickEdit: false });
    const automation = await automationPromise;
    browser = automation.browser;
    activeBrowser = browser;
    const page = automation.page;
    const keyField = page.locator("#serialNumber");

    await page.goto(SITE_URL, { waitUntil: "commit" });
    board.complete("access");

    const generateButton = page.getByText(/generate loader/i).first();
    await waitForGenerateAfterKey(page, keyField, generateButton, key);
    board.complete("enterKey");
    readKeyTimeLeft(page)
      .then(updateHeaderKeyTime)
      .catch(() => updateHeaderKeyTime("not shown by site"));

    // 3) Click "Generate Loader" and capture the download it triggers.
    const savePath = await downloadLoader(board, browser, page, generateButton);
    board.complete("generate");

    if (!SHOW_BROWSER) {
      closeBrowserPromise = trackBrowserClose(browser);
    }

    const launched = runDownloaded(savePath);
    if (launched) {
      board.complete("run");
    }

    if (SHOW_BROWSER) {
      console.log("\nKeeping the browser open for 30 seconds so you can confirm everything finished...");
      await page.waitForTimeout(30000);
      closeBrowserPromise = trackBrowserClose(browser);
    }

    if (launched) {
      await printFinishedBanner();
    } else if (!RUN_DOWNLOADED) {
      console.log(color("\nThe file was saved, but LINEAR_NO_RUN is set so it was not launched.", ANSI.red));
    } else {
      console.log(
        color("\nThe file was saved but is not an .exe, so it was not run.", ANSI.red)
      );
      process.exitCode = 1;
    }

    await closeBrowserPromise;
    if (activeBrowser === browser) {
      activeBrowser = null;
    }
  } catch (err) {
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

installCancellationHandlers();

main()
  .then(() => {
    // Force the process to close once everything is done, even if the browser
    // or a detached handle would otherwise keep it alive.
    showCursor();
    process.exit(process.exitCode || 0);
  })
  .catch((err) => {
    showCursor();
    console.error("\nSomething went wrong:");
    console.error(err && err.message ? err.message : err);
    if (!err || !err.isFriendly) {
      console.error(
        "\nTip: the site's buttons may use different text/markup than this script expects.\n" +
          "Run with LINEAR_SHOW_BROWSER=1 to watch it run and see where it stopped,\n" +
          "then adjust the selectors near the numbered steps in get-loader.js."
      );
    }
    process.exit(1);
  });
