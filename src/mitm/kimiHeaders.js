/**
 * Outbound header set for the Kimi Code (`kimi-coding`) provider.
 *
 * Uses the user's existing KimiCLI device_id so traffic from this app appears
 * under the same KimiCLI device, not as a separate "Unknown" login on the Kimi
 * dashboard.
 */

import fs from "fs";
import os from "os";
import path from "path";

const HOME = os.homedir();

function kimiCliSetupError(message) {
  const err = new Error(message);
  err.code = "KIMI_CLI_NOT_READY";
  return err;
}

function readKimiCliDeviceId() {
  const devicePath = path.join(HOME, ".kimi", "device_id");
  try {
    const value = fs.readFileSync(devicePath, "utf8").trim();
    if (value) return value;
  } catch {}

  throw kimiCliSetupError(
    "KimiCLI device_id was not found. Log into KimiCLI first, then retry kimi-coding."
  );
}

function detectKimiCliVersion() {
  const appData = process.env.APPDATA || path.join(HOME, ".config");
  const candidates = [
    path.join(appData, "uv", "tools", "kimi-cli", "Lib", "site-packages"),
    path.join(HOME, ".local", "share", "uv", "tools", "kimi-cli", "lib", "python3.11", "site-packages"),
  ];

  for (const sitePackages of candidates) {
    try {
      const distInfo = fs.readdirSync(sitePackages)
        .find(name => name.startsWith("kimi_cli-") && name.endsWith(".dist-info"));
      const match = distInfo && distInfo.match(/^kimi_cli-(.+?)\.dist-info$/);
      if (match) return match[1];
    } catch {}
  }

  return process.env.KIMI_CLI_VERSION_OVERRIDE || "1.33.0";
}

function deviceModel() {
  const platform = os.platform();
  const archRaw = os.arch();
  const arch = archRaw === "x64" ? "AMD64" : archRaw.toUpperCase();

  if (platform === "win32") {
    const build = parseInt(os.release().split(".")[2] || "0", 10);
    return `Windows ${build >= 22000 ? "11" : "10"} ${arch}`;
  }

  if (platform === "darwin") {
    return `macOS ${os.release()} ${arch}`;
  }

  return `${platform} ${os.release()} ${arch}`;
}

const KIMI_CLI_VERSION = detectKimiCliVersion();
const KIMI_USER_AGENT = `KimiCLI/${KIMI_CLI_VERSION}`;
const KIMI_DEVICE_MODEL = deviceModel();
const KIMI_DEVICE_NAME = os.hostname();
const KIMI_OS_VERSION = os.release();

export function kimiOutboundHeaders() {
  return {
    "User-Agent": KIMI_USER_AGENT,
    "X-Msh-Platform": "kimi_cli",
    "X-Msh-Version": KIMI_CLI_VERSION,
    "X-Msh-Device-Name": KIMI_DEVICE_NAME,
    "X-Msh-Device-Model": KIMI_DEVICE_MODEL,
    "X-Msh-Os-Version": KIMI_OS_VERSION,
    "X-Msh-Device-Id": readKimiCliDeviceId(),
  };
}
