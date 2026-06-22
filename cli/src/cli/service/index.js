// 9router service — cross-platform service management (install/uninstall/start/
// stop/restart/status). Generated units launch the standalone custom-server.js
// (the IP-hardening wrapper), never bare server.js.
//
// Linux: systemd user unit (~/.config/systemd/user/9router.service), no root.
// macOS: launchd plist (~/Library/LaunchAgents/com.9router.server.plist).
// Windows: node-windows Service (requires `node-windows` — see windowsService()).
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const SERVICE_NAME = "9router";
const VALID_ACTIONS = ["install", "uninstall", "start", "stop", "restart", "status"];

function sh(cmd) {
  return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function trySh(cmd) {
  try { return sh(cmd); } catch { return null; }
}

function buildEnvLines(env) {
  return Object.entries(env).map(([k, v]) => `Environment=${k}=${v}`).join("\n");
}

// ── Linux: systemd user unit ──────────────────────────────────────────────
function systemdUnitPath() {
  return path.join(os.homedir(), ".config", "systemd", "user", `${SERVICE_NAME}.service`);
}

function systemdUnitText(nodeBin, customServerPath, standaloneDir, env) {
  return [
    "[Unit]",
    `Description=9Router Server`,
    "After=network.target",
    "",
    "[Service]",
    `WorkingDirectory=${standaloneDir}`,
    `ExecStart="${nodeBin}" "${customServerPath}"`,
    buildEnvLines(env),
    "Restart=on-failure",
    "RestartSec=3",
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n");
}

function systemd(action, ctx, nodeBin, env) {
  const unitPath = systemdUnitPath();
  const unitDir = path.dirname(unitPath);
  const text = systemdUnitText(nodeBin, ctx.customServerPath, ctx.standaloneDir, env);

  if (action === "install") {
    fs.mkdirSync(unitDir, { recursive: true });
    fs.writeFileSync(unitPath, text);
    sh("systemctl --user daemon-reload");
    sh(`systemctl --user enable --now ${SERVICE_NAME}`);
    console.log(`✅ Installed + started ${SERVICE_NAME} (user unit: ${unitPath})`);
    return;
  }
  if (action === "uninstall") {
    trySh(`systemctl --user disable --now ${SERVICE_NAME}`);
    if (fs.existsSync(unitPath)) fs.unlinkSync(unitPath);
    sh("systemctl --user daemon-reload");
    console.log(`✅ Uninstalled ${SERVICE_NAME}`);
    return;
  }
  if (action === "status") {
    const active = trySh(`systemctl --user is-active ${SERVICE_NAME}`);
    console.log(`${SERVICE_NAME}: ${active || "not-found"}`);
    const detail = trySh(`systemctl --user status ${SERVICE_NAME} --no-pager -l`);
    if (detail) console.log(detail);
    return;
  }
  // start / stop / restart
  sh(`systemctl --user ${action} ${SERVICE_NAME}`);
  console.log(`✅ ${SERVICE_NAME}: ${action}`);
}

// ── macOS: launchd plist ──────────────────────────────────────────────────
function launchdPlistPath() {
  return path.join(os.homedir(), "Library", "LaunchAgents", "com.9router.server.plist");
}

function launchdPlist(nodeBin, customServerPath, standaloneDir, env) {
  const envEntries = Object.entries(env)
    .map(([k, v]) => `<key>${k}</key><string>${v}</string>`)
    .join("");
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">`,
    `<plist version="1.0">`,
    `<dict>`,
    `  <key>Label</key><string>com.9router.server</string>`,
    `  <key>WorkingDirectory</key><string>${standaloneDir}</string>`,
    `  <key>ProgramArguments</key>`,
    `  <array>`,
    `    <string>${nodeBin}</string>`,
    `    <string>${customServerPath}</string>`,
    `  </array>`,
    `  <key>EnvironmentVariables</key><dict>${envEntries}</dict>`,
    `  <key>RunAtLoad</key><true/>`,
    `  <key>KeepAlive</key><true/>`,
    `</dict>`,
    `</plist>`,
    ``,
  ].join("\n");
}

function launchd(action, ctx, nodeBin, env) {
  const plistPath = launchdPlistPath();
  const label = "com.9router.server";
  if (action === "install") {
    fs.mkdirSync(path.dirname(plistPath), { recursive: true });
    fs.writeFileSync(plistPath, launchdPlist(nodeBin, ctx.customServerPath, ctx.standaloneDir, env));
    sh(`launchctl load ${plistPath}`);
    console.log(`✅ Installed + loaded ${SERVICE_NAME} (plist: ${plistPath})`);
    return;
  }
  if (action === "uninstall") {
    trySh(`launchctl unload ${plistPath}`);
    if (fs.existsSync(plistPath)) fs.unlinkSync(plistPath);
    console.log(`✅ Uninstalled ${SERVICE_NAME}`);
    return;
  }
  if (action === "status") {
    const out = trySh(`launchctl list ${label}`);
    console.log(out || `${SERVICE_NAME}: not-loaded`);
    return;
  }
  // start / stop / restart
  if (action === "restart") {
    trySh(`launchctl stop ${label}`);
    sh(`launchctl start ${label}`);
  } else {
    sh(`launchctl ${action} ${label}`);
  }
  console.log(`✅ ${SERVICE_NAME}: ${action}`);
}

// ── Windows: node-windows Service ─────────────────────────────────────────
// node-windows is NOT a bundled dependency (avoids native-build churn in the
// global CLI). install/uninstall are therefore NOT implemented; start/stop/
// status work via sc.exe / net only once the service has been installed
// out-of-band with node-windows.
function windowsService(action, ctx, nodeBin, env) {
  const svcName = "9Router";
  if (action === "status") {
    const out = trySh(`sc query ${svcName}`);
    console.log(out || `${SERVICE_NAME}: not-installed`);
    return;
  }
  if (action === "start" || action === "stop") {
    sh(action === "start" ? `net start ${svcName}` : `net stop ${svcName}`);
    console.log(`✅ ${SERVICE_NAME}: ${action}`);
    return;
  }
  if (action === "restart") {
    trySh(`net stop ${svcName}`);
    sh(`net start ${svcName}`);
    console.log(`✅ ${SERVICE_NAME}: restart`);
    return;
  }
  // install / uninstall
  console.error(`Windows service '${action}' requires manual setup — node-windows is not bundled.`);
  console.error("Options:");
  console.error("  1. node-windows: npm i -g node-windows, then use its Service API (see docs/service-windows.md).");
  console.error("  2. sc.exe: sc create 9Router binPath= \"node path\\to\\custom-server.js\" (see docs/service-windows.md).");
  console.error("  3. Docker/CI: run 9router in a container or as a scheduled task instead.");
  console.error("Full guide: https://github.com/bloodf/9router/blob/main/docs/service-windows.md");
  process.exit(2);
}

// ── Entry ─────────────────────────────────────────────────────────────────
function runServiceCommand(subArgs, ctx) {
  const action = subArgs[0] || "status";
  if (!VALID_ACTIONS.includes(action)) {
    console.error(`Unknown service action: ${action}`);
    console.error(`Usage: 9router service <${VALID_ACTIONS.join("|")}>`);
    process.exit(2);
  }
  // Service units MUST launch custom-server.js (IP-hardening wrapper), not the
  // bare server.js fallback. Refuse if it is absent.
  if (!ctx.customServerPath || !fs.existsSync(ctx.customServerPath)) {
    console.error("Error: custom-server.js not found in standalone bundle.");
    console.error("Run `npm run build` first.");
    process.exit(1);
  }
  const nodeBin = process.execPath;
  const env = {
    PORT: String(ctx.port || 20128),
    HOSTNAME: ctx.host || "0.0.0.0",
    NODE_ENV: "production",
  };
  const platform = process.platform;
  try {
    if (platform === "linux") return systemd(action, ctx, nodeBin, env);
    if (platform === "darwin") return launchd(action, ctx, nodeBin, env);
    if (platform === "win32") return windowsService(action, ctx, nodeBin, env);
    console.error(`Unsupported platform for service management: ${platform}`);
    process.exit(2);
  } catch (e) {
    console.error(`service ${action} failed: ${e.message}`);
    process.exit(1);
  }
}

module.exports = { runServiceCommand, systemdUnitText, systemdUnitPath, launchdPlist, launchdPlistPath };
