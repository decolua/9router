const { Input, Confirm, Select } = require("enquirer");

const COLORS = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  underline: "\x1b[4m",
  reverse: "\x1b[7m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  white: "\x1b[37m",
  bgGreen: "\x1b[42m",
  bgBlue: "\x1b[44m",
  black: "\x1b[30m",
  terracotta: "\x1b[38;2;217;119;87m",
  bgTerracotta: "\x1b[48;2;217;119;87m"
};

// Hex color used by enquirer styles
const TERRACOTTA_HEX = "#D97757";

function handleCancel(err) {
  // Enquirer throws empty string on ESC/Ctrl+C — treat as cancel
  if (err === "" || err === undefined) return null;
  throw err;
}

// Workaround enquirer raw-mode bug (PR #460): prime stdin into raw mode
// + utf8 encoding BEFORE each prompt so arrow keys don't leak as ^[[A/^[[B.
function primeStdin() {
  if (!process.stdin.isTTY) return;
  try {
    process.stdin.setRawMode(true);
    process.stdin.setEncoding("utf8");
    process.stdin.resume();
  } catch {}
}

function restoreStdin() {
  if (!process.stdin.isTTY) return;
  try {
    process.stdin.setRawMode(false);
  } catch {}
  process.stdin.pause();
}

async function runPrompt(p) {
  primeStdin();
  try {
    return await p.run();
  } finally {
    restoreStdin();
  }
}

async function prompt(question) {
  const p = new Input({ name: "value", message: question.replace(/:\s*$/, "") });
  try {
    const answer = await runPrompt(p);
    return (answer || "").trim();
  } catch (err) {
    return handleCancel(err) ?? "";
  }
}

async function select(question, options) {
  const p = new Select({
    name: "value",
    message: question,
    choices: options.map((label, i) => ({ name: String(i), message: label })),
  });
  try {
    const answer = await runPrompt(p);
    return parseInt(answer, 10);
  } catch (err) {
    handleCancel(err);
    return -1;
  }
}

async function confirm(question) {
  const p = new Confirm({ name: "value", message: question });
  try {
    return await runPrompt(p);
  } catch (err) {
    handleCancel(err);
    return false;
  }
}

async function pause(message = "Press Enter to continue...") {
  const p = new Input({ name: "value", message });
  try {
    await runPrompt(p);
  } catch (err) {
    handleCancel(err);
  }
}

/**
 * Interactive arrow-key menu using enquirer Select.
 * Header (title/subtitle/breadcrumb/headerContent) rendered before prompt.
 */
async function selectMenu(title, items, defaultIndex = 0, subtitle = "", headerContent = "", breadcrumb = []) {
  process.stdout.write("\x1b[2J\x1b[H");
  const width = Math.min(process.stdout.columns || 40, 40);
  console.log(`\n${COLORS.terracotta}${"=".repeat(width)}${COLORS.reset}`);
  console.log(`  ${COLORS.bright}${COLORS.terracotta}${title}${COLORS.reset}`);
  if (subtitle) {
    console.log(`  ${COLORS.dim}${subtitle}${COLORS.reset}`);
  }
  console.log(`${COLORS.terracotta}${"=".repeat(width)}${COLORS.reset}`);
  if (breadcrumb.length > 0) {
    console.log(`  ${COLORS.dim}${breadcrumb.join(" > ")}${COLORS.reset}`);
  }
  console.log();
  if (headerContent) {
    console.log(headerContent);
    console.log();
  }

  const p = new Select({
    name: "menu",
    message: "Select",
    initial: defaultIndex,
    choices: items.map((item, i) => ({ name: String(i), message: item.label })),
  });

  try {
    const answer = await runPrompt(p);
    return parseInt(answer, 10);
  } catch (err) {
    handleCancel(err);
    return -1;
  }
}

module.exports = {
  prompt,
  select,
  confirm,
  pause,
  selectMenu,
  COLORS
};
