const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

function defaultDataDir() {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "9router");
  }
  return path.join(os.homedir(), ".9router");
}

function parseDataDir(args) {
  const index = args.indexOf("--data-dir");
  if (index >= 0 && args[index + 1]) return path.resolve(args[index + 1]);
  return process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : defaultDataDir();
}

async function run(args = []) {
  const secretPath = path.join(parseDataDir(args), "secrets", "codex-bridge-token");
  let token;
  try {
    token = fs.readFileSync(secretPath, "utf8").trim();
  } catch {
    console.error("9Router Codex bridge token is not configured. Apply Codex settings in the 9Router dashboard.");
    return 1;
  }
  if (!token) {
    console.error("9Router Codex bridge token is empty. Re-apply Codex settings in the 9Router dashboard.");
    return 1;
  }
  process.stdout.write(`${token}\n`);
  return 0;
}

module.exports = { run };
