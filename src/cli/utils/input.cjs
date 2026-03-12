const readline = require("readline");

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
  // Terracotta/Earth orange - using RGB escape code
  terracotta: "\x1b[38;2;217;119;87m",  // #D97757
  bgTerracotta: "\x1b[48;2;217;119;87m"
};

/**
 * Ask a question and return the user's answer
 * @param {string} question - The question to ask
 * @returns {Promise<string>} The user's answer
 */
async function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Show a numbered menu and return the selected option number
 * @param {string} question - The question to ask
 * @param {string[]} options - Array of options to display
 * @returns {Promise<number>} The selected option index (0-based)
 */
async function select(question, options) {
  console.log(question);
  options.forEach((option, index) => {
    console.log(`  ${index + 1}. ${option}`);
  });

  while (true) {
    const answer = await prompt("\nSelect option (number): ");
    const num = parseInt(answer, 10);

    if (!isNaN(num) && num >= 1 && num <= options.length) {
      return num - 1;
    }

    console.log(`Invalid selection. Please enter a number between 1 and ${options.length}`);
  }
}

/**
 * Ask a yes/no question and return boolean
 * @param {string} question - The question to ask
 * @returns {Promise<boolean>} True for yes, false for no
 */
async function confirm(question) {
  while (true) {
    const answer = await prompt(`${question} (y/n): `);
    const lower = answer.toLowerCase();

    if (lower === "y" || lower === "yes") {
      return true;
    }
    if (lower === "n" || lower === "no") {
      return false;
    }

    console.log("Please answer 'y' or 'n'");
  }
}

/**
 * Pause execution until user presses Enter
 * @param {string} [message="Press Enter to continue..."] - Message to display
 * @returns {Promise<void>}
 */
async function pause(message = "Press Enter to continue...") {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(message, () => {
      rl.close();
      resolve();
    });
  });
}

/**
 * Show interactive menu with arrow key navigation
 * @param {string} title - Menu title
 * @param {Array<{label: string, icon?: string}>} items - Menu items
 * @param {number} defaultIndex - Default selected index
 * @param {string} headerContent - Optional content to show above menu
 * @param {Array<string>} breadcrumb - Optional breadcrumb path
 * @returns {Promise<number>} Selected index, or -1 if ESC pressed
 */
async function selectMenu(title, items, defaultIndex = 0, subtitle = "", headerContent = "", breadcrumb = []) {
  return new Promise((resolve) => {
    let selectedIndex = defaultIndex;
    let isActive = true;
    
    // Remove any existing keypress listeners first
    process.stdin.removeAllListeners("keypress");
    
    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) {
      try {
        process.stdin.setRawMode(true);
      } catch (err) {
        // TTY disconnected or EIO error - exit gracefully
        resolve(-1);
        return;
      }
    }

    const renderMenu = () => {
      if (!isActive) return;
      
      // Clear previous menu
      process.stdout.write("\x1b[2J\x1b[H");
      
      // Show title with terracotta color
      const width = Math.min(process.stdout.columns || 40, 40);
      console.log(`\n${COLORS.terracotta}${"=".repeat(width)}${COLORS.reset}`);
      console.log(`  ${COLORS.bright}${COLORS.terracotta}${title}${COLORS.reset}`);
      
      // Show subtitle inside the frame
      if (subtitle) {
        console.log(`  ${COLORS.dim}${subtitle}${COLORS.reset}`);
      }
      
      console.log(`${COLORS.terracotta}${"=".repeat(width)}${COLORS.reset}`);
      
      // Show breadcrumb if provided
      if (breadcrumb.length > 0) {
        console.log(`  ${COLORS.dim}${breadcrumb.join(" > ")}${COLORS.reset}`);
      }
      console.log();
      
      // Show header content if provided
      if (headerContent) {
        console.log(headerContent);
        console.log();
      }
      
      // Show menu items with proper alignment
      items.forEach((item, index) => {
        const isSelected = index === selectedIndex;
        
        // Fallback to ASCII on Windows (cmd/powershell can't render unicode stars)
        const isWin = process.platform === "win32";
        const icon = isSelected ? (isWin ? ">" : "★") : (isWin ? " " : "☆");
        
        if (isSelected) {
          // Selected: reverse + bright for high visibility on any terminal
          console.log(` ${COLORS.reverse}${COLORS.bright}${icon} ${item.label}${COLORS.reset}`);
        } else {
          // Not selected: plain text with empty star
          console.log(`  ${icon} ${item.label}`);
        }
      });
    };

    const cleanup = () => {
      if (!isActive) return;
      isActive = false;
      
      if (process.stdin.isTTY) {
        try {
          process.stdin.setRawMode(false);
        } catch (err) {
          // Ignore cleanup errors
        }
      }
      process.stdin.removeListener("keypress", onKeypress);
      process.stdin.pause();
    };

    const onKeypress = (str, key) => {
      if (!isActive || !key) return;
      
      if (key.name === "up") {
        selectedIndex = (selectedIndex - 1 + items.length) % items.length;
        renderMenu();
      } else if (key.name === "down") {
        selectedIndex = (selectedIndex + 1) % items.length;
        renderMenu();
      } else if (key.name === "return") {
        cleanup();
        resolve(selectedIndex);
      } else if (key.name === "escape") {
        cleanup();
        resolve(-1);
      } else if (key.ctrl && key.name === "c") {
        cleanup();
        process.exit(0);
      }
    };

    process.stdin.on("keypress", onKeypress);
    process.stdin.resume();
    renderMenu();
  });
}

module.exports = {
  prompt,
  select,
  confirm,
  pause,
  selectMenu
};
