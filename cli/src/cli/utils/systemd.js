/**
 * systemd.js — Manages 9Router as a systemd user service on Linux.
 *
 * Uses `systemctl --user` so no root privileges are required.
 * The service unit file is written to ~/.config/systemd/user/9router.service
 *
 * Public API
 * ----------
 *   isSystemdAvailable()          → bool
 *   installService(cliPath?)      → bool
 *   uninstallService()            → bool
 *   startService()                → bool
 *   stopService()                 → bool
 *   enableService(cliPath?)       → bool  (install + enable + start)
 *   disableService()              → bool  (stop + disable + uninstall)
 *   isServiceEnabled()            → bool
 *   isServiceActive()             → bool
 *   getServiceStatus()            → string | null
 */

"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

const SERVICE_NAME = "9router";
const SERVICE_FILE = `${SERVICE_NAME}.service`;

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function getSystemdUserDir() {
    return path.join(os.homedir(), ".config", "systemd", "user");
}

function getServiceFilePath() {
    return path.join(getSystemdUserDir(), SERVICE_FILE);
}

/**
 * Resolve the absolute path to cli.js (same logic as autostart.js).
 */
function getCliJsPath(cliPath) {
    if (cliPath) {
        const resolved = path.resolve(cliPath);
        if (fs.existsSync(resolved)) return resolved;
    }
    if (process.argv[1]) {
        const resolved = path.resolve(process.argv[1]);
        if (path.basename(resolved) === "cli.js" && fs.existsSync(resolved)) {
            return resolved;
        }
    }
    // autostart.js lives at <pkg>/src/cli/tray/autostart.js
    // systemd.js lives at   <pkg>/src/cli/utils/systemd.js
    // cli.js lives at       <pkg>/cli.js  (three levels up from utils/)
    const computed = path.resolve(__dirname, "..", "..", "..", "cli.js");
    if (fs.existsSync(computed)) return computed;
    return null;
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * Returns true when systemd user session is reachable on this machine.
 *
 * Checks:
 *   1. Platform must be linux.
 *   2. `systemctl` must be in PATH.
 *   3. `systemctl --user is-system-running` must exit 0 or produce output
 *      that indicates a running/degraded/starting user session — a degraded
 *      state still allows unit management.
 *
 * The check is done with a 2-second timeout so a misconfigured environment
 * never hangs the CLI.
 */
function isSystemdAvailable() {
    if (process.platform !== "linux") return false;

    try {
        const output = execSync("systemctl --user is-system-running 2>/dev/null || true", {
            encoding: "utf8",
            timeout: 2000,
            stdio: ["ignore", "pipe", "ignore"]
        }).trim();

        // Acceptable states: running, degraded, starting
        return ["running", "degraded", "starting"].includes(output);
    } catch (e) {
        return false;
    }
}

// ---------------------------------------------------------------------------
// Service unit file management
// ---------------------------------------------------------------------------

/**
 * Write a systemd user service unit file.
 * Returns true on success.
 */
function installService(cliPath) {
    if (process.platform !== "linux") return false;

    const nodePath = process.execPath;
    const routerScript = getCliJsPath(cliPath);
    if (!routerScript) return false;

    const serviceDir = getSystemdUserDir();
    try {
        fs.mkdirSync(serviceDir, { recursive: true });
    } catch (e) {
        return false;
    }

    // Build a PATH that includes node's bin dir so npm scripts spawned by the
    // server (runtime installs, etc.) can find node.
    const nodeBin = path.dirname(nodePath);
    const envPath = [nodeBin, "/usr/local/bin", "/usr/bin", "/bin"].join(":");

    const unitContent = `[Unit]
Description=9Router API Proxy Service
Documentation=https://github.com/9router/9router
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${nodePath} ${routerScript} --tray --skip-update
Restart=on-failure
RestartSec=5s
Environment=PATH=${envPath}
Environment=NODE_ENV=production
# Capture logs: journalctl --user -u ${SERVICE_NAME} -f
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${SERVICE_NAME}

[Install]
WantedBy=default.target
`;

    try {
        fs.writeFileSync(getServiceFilePath(), unitContent, { mode: 0o644 });
    } catch (e) {
        return false;
    }

    // Reload unit index so systemctl is aware of the new file.
    try {
        execSync("systemctl --user daemon-reload", {
            stdio: "ignore",
            timeout: 5000
        });
    } catch (e) {
        // daemon-reload failure is non-fatal; the unit file is still on disk.
    }

    return true;
}

/**
 * Remove the unit file (does NOT stop/disable first — caller's responsibility).
 */
function uninstallService() {
    const filePath = getServiceFilePath();
    if (fs.existsSync(filePath)) {
        try {
            fs.unlinkSync(filePath);
        } catch (e) {
            return false;
        }
    }

    try {
        execSync("systemctl --user daemon-reload", {
            stdio: "ignore",
            timeout: 5000
        });
    } catch (e) { }

    return true;
}

// ---------------------------------------------------------------------------
// Lifecycle control
// ---------------------------------------------------------------------------

function runSystemctl(...args) {
    try {
        execSync(`systemctl --user ${args.join(" ")}`, {
            stdio: "ignore",
            timeout: 10000
        });
        return true;
    } catch (e) {
        return false;
    }
}

function startService() {
    return runSystemctl("start", SERVICE_FILE);
}

function stopService() {
    return runSystemctl("stop", SERVICE_FILE);
}

// ---------------------------------------------------------------------------
// High-level helpers used by autostart.js and cli.js
// ---------------------------------------------------------------------------

/**
 * Install, enable (persist across reboots) and immediately start the service.
 * Mirrors macOS `launchctl load -w` behaviour.
 */
function enableService(cliPath) {
    if (!isSystemdAvailable()) return false;
    if (!installService(cliPath)) return false;

    // Enable so it starts on next login/boot.
    runSystemctl("enable", SERVICE_FILE);

    // Start immediately so the user doesn't have to wait.
    return runSystemctl("start", SERVICE_FILE);
}

/**
 * Stop the service, disable it, and remove the unit file.
 */
function disableService() {
    if (process.platform !== "linux") return false;

    // Best-effort stop; ignore failure (service may already be stopped).
    runSystemctl("stop", SERVICE_FILE);
    runSystemctl("disable", SERVICE_FILE);
    uninstallService();

    return true;
}

// ---------------------------------------------------------------------------
// Status queries
// ---------------------------------------------------------------------------

/**
 * Returns true if the service is enabled to start on boot.
 */
function isServiceEnabled() {
    if (process.platform !== "linux") return false;
    if (!fs.existsSync(getServiceFilePath())) return false;

    try {
        execSync(`systemctl --user is-enabled ${SERVICE_FILE} 2>/dev/null`, {
            stdio: "ignore",
            timeout: 3000
        });
        return true; // exit 0 → enabled
    } catch (e) {
        return false;
    }
}

/**
 * Returns true if the service unit is currently in an active (running) state.
 */
function isServiceActive() {
    if (process.platform !== "linux") return false;

    try {
        execSync(`systemctl --user is-active --quiet ${SERVICE_FILE} 2>/dev/null`, {
            stdio: "ignore",
            timeout: 3000
        });
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * Returns a human-readable status string, or null on error.
 * Example: "active (running) since Mon 2025-01-01 12:00:00 UTC; 5min ago"
 */
function getServiceStatus() {
    if (process.platform !== "linux") return null;

    try {
        const output = execSync(
            `systemctl --user show ${SERVICE_FILE} --property=ActiveState,SubState,MainPID 2>/dev/null`,
            { encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] }
        ).trim();

        // Parse key=value lines
        const map = {};
        output.split("\n").forEach((line) => {
            const [k, v] = line.split("=");
            if (k && v !== undefined) map[k.trim()] = v.trim();
        });

        const state = map.ActiveState || "unknown";
        const sub = map.SubState || "";
        const pid = map.MainPID && map.MainPID !== "0" ? ` (PID ${map.MainPID})` : "";
        return `${state}${sub ? ` (${sub})` : ""}${pid}`;
    } catch (e) {
        return null;
    }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
    isSystemdAvailable,
    installService,
    uninstallService,
    startService,
    stopService,
    enableService,
    disableService,
    isServiceEnabled,
    isServiceActive,
    getServiceStatus
};
