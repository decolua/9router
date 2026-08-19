const { spawnSync } = require("child_process");

function runClipboardCommand(command, args, text) {
  try {
    const result = spawnSync(command, args, {
      input: String(text),
      stdio: ["pipe", "ignore", "ignore"],
      // `clip.exe` otherwise inherits a console when invoked from a tray
      // action on Windows.  Keep every supported command direct (no shell).
      windowsHide: true,
      timeout: 3000,
      shell: false,
    });
    return !result.error && result.status === 0;
  } catch {
    return false;
  }
}

/**
 * Copy text to clipboard based on OS
 * @param {string} text - Text to copy
 * @returns {boolean} Success status
 */
function copyToClipboard(text) {
  const platform = process.platform;

  if (platform === "darwin") {
    return runClipboardCommand("pbcopy", [], text);
  }
  if (platform === "win32") {
    return runClipboardCommand("clip.exe", [], text);
  }

  // Linux - try xclip first, then xsel.  Supplying argv separately prevents
  // the clipboard text from ever being interpreted by a shell.
  return runClipboardCommand("xclip", ["-selection", "clipboard"], text)
    || runClipboardCommand("xsel", ["--clipboard", "--input"], text);
}

module.exports = { copyToClipboard, __test__: { runClipboardCommand } };
