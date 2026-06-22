#!/usr/bin/env node
"use strict";

// Wave-1 install-time legacy migration helper.
// SAFE: data extraction + detect-and-instruct only.
// Wave 2 (service stop/disable/uninstall) is NOT done here.

const fs = require("node:fs");
const path = require("path");
const os = require("os");

/**
 * Heuristic: returns true when the current working directory is inside a
 * repo/workspace (has a parent containing both .git AND a package.json that
 * names the workspace). Conservative — when ambiguous we return true (skip).
 */
function _isInsideWorkspace() {
  try {
    const cwd = process.env.INIT_CWD || process.cwd();
    let dir = path.resolve(cwd);
    const root = path.parse(dir).root;
    while (dir !== root) {
      const hasDotGit =
        fs.existsSync(path.join(dir, ".git")) ||
        // bare worktree ref file
        fs.existsSync(path.join(dir, "HEAD"));
      if (hasDotGit && fs.existsSync(path.join(dir, "package.json"))) {
        return true;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return false;
  } catch (_) {
    return true; // conservative: uncertain → skip
  }
}

/**
 * migrateLegacy9router({ force })
 *
 * Gate (all must pass, unless force=true overrides context gate):
 *   1. ~/.9router must exist (legacy present)
 *   2. Real install context: npm_config_global === 'true' OR
 *      (no CI env AND INIT_CWD/cwd is NOT inside a workspace)
 *
 * Action (past gate):
 *   - Trigger getDataDir() to run the non-destructive copy.
 *   - Detect old service artifacts; log an instruction if found.
 *
 * Always: idempotent, non-destructive, non-fatal.
 */
function migrateLegacy9router(opts) {
  opts = opts || {};
  try {
    // --- GATE 1: legacy must exist ---
    const legacyDir = path.join(os.homedir(), ".9router");
    if (!fs.existsSync(legacyDir)) {
      return; // nothing to migrate
    }

    // --- GATE 2: context (skipped when force=true) ---
    // STRICT: only a confirmed global install (`npm i -g`) or explicit force.
    // Non-global installs (local deps, workspaces, dev) are ambiguous -> SKIP
    // (never touch ~/.9router home state on an ordinary local install).
    if (!opts.force) {
      const isGlobal = process.env.npm_config_global === "true";
      if (!isGlobal) {
        return; // not a global install — skip
      }
    }

    // --- ACTION ---

    // Trigger canonical copy (~/.9router → ~/.durindoor, legacy kept).
    // dataDir.cjs path is relative to this file (cli/hooks/ → ../../src/lib/).
    const { getDataDir } = require("../../src/lib/dataDir.cjs");
    getDataDir();
    console.log("[durindoor] migrated data from ~/.9router");

    // --- DETECT old service artifacts (read-only, no modification) ---
    const home = os.homedir();
    const serviceArtifacts = [
      // systemd user unit
      path.join(home, ".config", "systemd", "user", "9router.service"),
      // launchd agents
      path.join(home, "Library", "LaunchAgents", "com.9router.server.plist"),
      path.join(home, "Library", "LaunchAgents", "com.9router.autostart.plist"),
    ];

    const found = serviceArtifacts.some((p) => fs.existsSync(p));
    if (found) {
      console.log(
        "[durindoor] old 9router service detected — run `durindoor service install` to migrate it."
      );
    }
  } catch (e) {
    console.warn("[durindoor] legacy migration skipped:", e.message);
  }
}

module.exports = { migrateLegacy9router };
