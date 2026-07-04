// set-exe-type.js
//
// Switches the saved spoofer / exe type (BE or none) that get-loader.js uses.
// This is the standalone replacement for the old in-run "[S] edit" editor: the
// main loader no longer lets you change the type mid-run, so use this instead.
//
// Just press 1 or 2 -- no Enter needed. It refuses to open while Get Loader is
// running so the two can't fight over the saved type.
//
// Run it from "Switch Spoofer Type.bat", or directly:
//   node set-exe-type.js          -> asks 1 or 2 (single key press)
//   node set-exe-type.js be       -> sets BE without asking
//   node set-exe-type.js none     -> sets none without asking

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const EXE_TYPE_FILE = path.join(__dirname, "exe-type.txt");
const LOADER_LOCK_FILE = path.join(__dirname, ".loader-running.lock");
const EXE_TYPE_DEFAULT = "no";

// --- Theme (matches get-loader.js so both screens look like one app) ----------
const BANNER_START = [105, 170, 255];
const BANNER_END = [40, 100, 235];
const CHARCOAL_START = [104, 109, 120];
const CHARCOAL_END = [188, 193, 205];
const WHITE = [240, 242, 248];
const RED = "\x1b[91m";
const RESET = "\x1b[0m";
const CONFIRM_HOLD_MS = 1300;

function lockConsoleInput() {
  if (process.platform !== "win32" || !process.stdout.isTTY) {
    return;
  }

  const script = `$s = @'
[DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr CreateFile(string n, uint a, uint sh, IntPtr t, uint c, uint f, IntPtr hh);
[DllImport("kernel32.dll")] public static extern IntPtr GetStdHandle(int n);
[DllImport("kernel32.dll")] public static extern bool GetConsoleMode(IntPtr h, out uint m);
[DllImport("kernel32.dll")] public static extern bool SetConsoleMode(IntPtr h, uint m);
'@; $k = Add-Type -MemberDefinition $s -Name ConsoleTweaks -Namespace ConIO -PassThru; $handles = @($k::GetStdHandle(-10), $k::CreateFile('CONIN$', [uint32]3221225472, 3, [IntPtr]::Zero, 3, 0, [IntPtr]::Zero)); foreach ($h in $handles) { if ($h -eq [IntPtr]::Zero -or $h -eq [IntPtr](-1)) { continue }; $m = 0; if ($k::GetConsoleMode($h, [ref]$m)) { $m = $m -bor 0x80; $m = $m -band (-bnot 0x40); $m = $m -band (-bnot 0x20); $m = $m -band (-bnot 0x10); $m = $m -band (-bnot 0x08); [void]$k::SetConsoleMode($h, $m) } }`;

  try {
    execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { timeout: 3000, windowsHide: true, stdio: "ignore" }
    );
  } catch {
    // Cosmetic hardening only; the picker still works if this fails.
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function blend(start, end, amount) {
  const t = clamp(amount, 0, 1);
  return start.map((value, index) => Math.round(value + (end[index] - value) * t));
}

function rgb(text, [r, g, b], bold = false) {
  return `\x1b[${bold ? "1;" : ""}38;2;${r};${g};${b}m${text}${RESET}`;
}

// Paint a string left-to-right along a two-colour gradient, by column.
function gradient(text, start, end) {
  const chars = [...text];
  const width = Math.max(1, chars.length);
  return chars
    .map((ch, index) =>
      ch === " " ? ch : rgb(ch, blend(start, end, width <= 1 ? 0 : index / (width - 1)))
    )
    .join("");
}

function banner(text) {
  return gradient(text, BANNER_START, BANNER_END);
}

function charcoal(text) {
  return gradient(text, CHARCOAL_START, CHARCOAL_END);
}

function termWidth() {
  return process.stdout.columns || 64;
}

function leftPad(visibleWidth) {
  return " ".repeat(Math.max(0, Math.floor((termWidth() - visibleWidth) / 2)));
}

// A screen line: its painted text plus the visible width used to centre it.
function line(colored, width) {
  return { colored, width };
}

function blank() {
  return line("", 0);
}

// --- Exe type storage (same rules / files get-loader.js uses) ------------------
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

function readSavedExeType() {
  if (!fs.existsSync(EXE_TYPE_FILE)) {
    return "";
  }

  const lines = fs
    .readFileSync(EXE_TYPE_FILE, "utf8")
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);

  for (const entry of lines) {
    const exeType = normalizeExeType(entry);
    if (exeType) {
      return exeType;
    }
  }

  return "";
}

function saveExeType(exeType) {
  fs.writeFileSync(EXE_TYPE_FILE, `${normalizeExeType(exeType) || EXE_TYPE_DEFAULT}\r\n`);
}

function saveChoice(exeType) {
  saveExeType(exeType);
}

// --- Run lock (don't switch while Get Loader is open) --------------------------
function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    // Signal 0 doesn't kill anything -- it just tests whether the PID exists.
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but we may not signal it: still "alive".
    return err && err.code === "EPERM";
  }
}

function loaderIsRunning() {
  let content;
  try {
    content = fs.readFileSync(LOADER_LOCK_FILE, "utf8");
  } catch {
    return false;
  }

  const pid = parseInt(String(content).split(/\r?\n/)[0], 10);
  if (isPidAlive(pid)) {
    return true;
  }

  // Stale lock left by a crashed loader -- clear it so we don't block forever.
  try {
    fs.unlinkSync(LOADER_LOCK_FILE);
  } catch {
    // Someone else already cleaned it up.
  }
  return false;
}

// --- Screens -------------------------------------------------------------------
function isInteractive() {
  return Boolean(
    process.stdin.isTTY &&
      process.stdout.isTTY &&
      typeof process.stdin.setRawMode === "function"
  );
}

function hideCursor() {
  if (process.stdout.isTTY) {
    process.stdout.write("\x1b[?25l");
  }
}

function showCursor() {
  if (process.stdout.isTTY) {
    process.stdout.write("\x1b[?25h");
  }
}

// Title header shared by every screen: LINEAR.PUB over a gradient rule.
function headerLines() {
  const title = "LINEAR.PUB";
  const subtitle = "spoofer type";
  const ruleWidth = Math.max(title.length, subtitle.length) + 2;
  return [
    blank(),
    blank(),
    line(rgb(title, WHITE, true), title.length),
    line(charcoal(subtitle), subtitle.length),
    line(banner("─".repeat(ruleWidth)), ruleWidth),
  ];
}

function paint(bodyLines) {
  const all = [...headerLines(), ...bodyLines, blank()];
  const body = all
    .map((entry) => (entry.width ? leftPad(entry.width) + entry.colored : ""))
    .join("\n");
  process.stdout.write(`\x1b[2J\x1b[H${body}\n`);
}

function currentLine(current) {
  const value = current ? formatExeType(current) : "not set";
  return line(
    charcoal("current  ") + rgb(value, BANNER_END, true),
    `current  ${value}`.length
  );
}

function optionsLine(current) {
  const beActive = current === "be";
  const noActive = current === "no";
  const be = rgb("[1]", BANNER_END, true) + rgb(" BE", beActive ? WHITE : CHARCOAL_END, beActive);
  const none = rgb("[2]", BANNER_END, true) + rgb(" none", noActive ? WHITE : CHARCOAL_END, noActive);
  const plain = "[1] BE       [2] none";
  return line(`${be}       ${none}`, plain.length);
}

function renderChoose(current, error) {
  // No standing hint line -- 1/2 pick and Esc cancels silently. A wrong key just
  // shows a brief red nudge under the options.
  const body = [blank(), currentLine(current), blank(), optionsLine(current)];
  if (error) {
    body.push(blank());
    body.push(
      line(`${RED}press 1 for BE or 2 for none${RESET}`, "press 1 for BE or 2 for none".length)
    );
  }
  paint(body);
}

function renderConfirm(exeType) {
  const done = `spoofer set to  ${formatExeType(exeType)}`;
  paint([
    blank(),
    currentLine(exeType),
    blank(),
    line(banner(done), done.length),
  ]);
}

function renderCancelled(current) {
  const msg = current ? `unchanged  ·  still ${formatExeType(current)}` : "unchanged";
  paint([blank(), line(charcoal(msg), msg.length)]);
}

function renderBlocked() {
  const l1 = "Get Loader is open";
  const l2 = "Close it first, then switch the spoofer type.";
  const l3 = "press any key to close";
  paint([
    blank(),
    line(`${RED}${l1}${RESET}`, l1.length),
    line(charcoal(l2), l2.length),
    blank(),
    line(charcoal(l3), l3.length),
  ]);
}

// Read a single keypress in raw mode. Resolves with the lowercased key, or a
// special token: "cancel" (Esc / Ctrl+C / q), "ignore" (arrows etc.), "" (Enter).
function readKey() {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    lockConsoleInput();
    stdin.resume();
    stdin.setEncoding("utf8");

    const onData = (text) => {
      stdin.off("data", onData);
      stdin.setRawMode(Boolean(wasRaw));
      stdin.pause();

      // Ctrl+C or a lone Esc or q cancels. Escape sequences (arrow / function
      // keys) also begin with Esc but carry more bytes -- ignore those.
      if (text.includes("")) {
        resolve("cancel");
        return;
      }
      if (text === "" || text.toLowerCase() === "q") {
        resolve("cancel");
        return;
      }
      if (text.startsWith("")) {
        resolve("ignore");
        return;
      }
      resolve(text.trim().charAt(0).toLowerCase());
    };

    stdin.on("data", onData);
  });
}

async function chooseInteractively(current) {
  let error = false;
  renderChoose(current, error);

  while (true) {
    const key = await readKey();

    if (key === "cancel") {
      return null;
    }
    if (key === "1") {
      return "be";
    }
    if (key === "2") {
      return "no";
    }
    if (key === "ignore" || key === "") {
      continue; // arrows / Enter / stray whitespace: keep waiting quietly
    }

    error = true;
    renderChoose(current, error);
  }
}

async function main() {
  process.on("exit", showCursor);
  lockConsoleInput();

  // 1) Never switch while the loader is mid-run.
  if (loaderIsRunning()) {
    if (isInteractive()) {
      hideCursor();
      renderBlocked();
      await readKey();
      return;
    }
    console.error("Get Loader is running. Close it before switching the spoofer type.");
    process.exit(1);
  }

  // 2) An explicit type on the command line just sets it, no UI.
  const cliType = normalizeExeType(process.argv[2]);
  if (cliType) {
    saveChoice(cliType);
    console.log(`Spoofer type set to: ${formatExeType(cliType)}`);
    return;
  }

  // 3) Otherwise ask with the single-key picker.
  if (!isInteractive()) {
    throw new Error(
      "No interactive console to pick a spoofer type. Pass 'be' or 'none' on the command line."
    );
  }

  hideCursor();
  const current = readSavedExeType();
  const choice = await chooseInteractively(current);

  if (!choice) {
    renderCancelled(current);
    await new Promise((resolve) => setTimeout(resolve, 700));
    return;
  }

  saveChoice(choice);
  renderConfirm(choice);
  await new Promise((resolve) => setTimeout(resolve, CONFIRM_HOLD_MS));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    showCursor();
    console.error();
    console.error(err && err.message ? err.message : err);
    process.exit(1);
  });
