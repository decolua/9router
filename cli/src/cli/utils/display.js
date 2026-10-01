const { formatNumber } = require("./format");

// ANSI color codes
const COLORS = {
  reset: "\x1b[0m",
  success: "\x1b[32m",
  error: "\x1b[31m",
  warning: "\x1b[33m",
  info: "\x1b[36m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  bright: "\x1b[1m",
  cyan: "\x1b[36m"
};

// Box drawing characters
const BOX_CHARS = {
  topLeft: "┌",
  topRight: "┐",
  bottomLeft: "└",
  bottomRight: "┘",
  horizontal: "─",
  vertical: "│"
};

/**
 * Draw a box with border around content
 * @param {string} title - Box title
 * @param {string} content - Content to display inside box
 * @param {number} [width=60] - Box width
 */
function showBox(title, content, width = 60) {
  const innerWidth = width - 4;
  const lines = content.split("\n");

  // Top border with title
  const topBorder = BOX_CHARS.topLeft + BOX_CHARS.horizontal.repeat(2) + 
    ` ${title} ` + 
    BOX_CHARS.horizontal.repeat(Math.max(0, innerWidth - title.length - 3)) + 
    BOX_CHARS.topRight;

  console.log(topBorder);

  // Content lines
  lines.forEach(line => {
    const paddedLine = line.padEnd(innerWidth);
    console.log(`${BOX_CHARS.vertical} ${paddedLine} ${BOX_CHARS.vertical}`);
  });

  // Bottom border
  const bottomBorder = BOX_CHARS.bottomLeft + 
    BOX_CHARS.horizontal.repeat(innerWidth + 2) + 
    BOX_CHARS.bottomRight;

  console.log(bottomBorder);
}

/**
 * Display a menu with numbered items
 * @param {string} title - Menu title
 * @param {string[]} items - Array of menu items
 * @param {string} [footer] - Optional footer text
 */
function showMenu(title, items, footer) {
  console.log(`\n${COLORS.bold}${title}${COLORS.reset}`);
  console.log(COLORS.dim + "─".repeat(title.length) + COLORS.reset);

  items.forEach((item, index) => {
    console.log(`  ${COLORS.info}${index + 1}.${COLORS.reset} ${item}`);
  });

  if (footer) {
    console.log(`\n${COLORS.dim}${footer}${COLORS.reset}`);
  }
  console.log();
}

/**
 * Display data in table format
 * @param {string[]} headers - Array of column headers
 * @param {Array<Array<string|number>>} rows - Array of row data
 */
function showTable(headers, rows) {
  if (!headers.length || !rows.length) {
    return;
  }

  // Calculate column widths
  const colWidths = headers.map((header, i) => {
    const maxDataWidth = Math.max(...rows.map(row => String(row[i] || "").length));
    return Math.max(header.length, maxDataWidth);
  });

  // Print header
  const headerRow = headers.map((h, i) => h.padEnd(colWidths[i])).join(" │ ");
  console.log(COLORS.bold + headerRow + COLORS.reset);

  // Print separator
  const separator = colWidths.map(w => "─".repeat(w)).join("─┼─");
  console.log(COLORS.dim + separator + COLORS.reset);

  // Print rows
  rows.forEach(row => {
    const rowStr = row.map((cell, i) => String(cell || "").padEnd(colWidths[i])).join(" │ ");
    console.log(rowStr);
  });
}

/**
 * Show colored status message
 * @param {string} message - Message to display
 * @param {string} [type="info"] - Status type: success, error, warning, info
 */
function showStatus(message, type = "info") {
  const symbols = {
    success: "✓",
    error: "✗",
    warning: "⚠",
    info: "ℹ"
  };

  const color = COLORS[type] || COLORS.info;
  const symbol = symbols[type] || symbols.info;

  console.log(`${color}${symbol} ${message}${COLORS.reset}`);
}

/**
 * Clear the terminal screen
 */
function clearScreen() {
  console.clear();
}

/**
 * Show menu header with title and subtitle
 * @param {string} title - Main title
 * @param {string} subtitle - Optional subtitle
 */
function showHeader(title, subtitle) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  ${COLORS.bright}${COLORS.cyan}${title}${COLORS.reset}`);
  if (subtitle) {
    console.log(`  ${COLORS.dim}${subtitle}${COLORS.reset}`);
  }
  console.log(`${"=".repeat(60)}\n`);
}

module.exports = {
  showBox,
  showMenu,
  showTable,
  showStatus,
  clearScreen,
  showHeader
};
