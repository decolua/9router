/**
 * Data directory resolution tests
 *
 * Tests the getUserDataDir() logic for resolving the 9router data directory.
 * This validates the behavior from the DATA_DIR / XDG_CONFIG_HOME fix (PR C).
 *
 * Covers:
 *  - DATA_DIR env var takes highest priority
 *  - XDG_CONFIG_HOME support on Linux/macOS
 *  - Backward compatibility: falls back to ~/.9router if XDG path doesn't exist
 *  - Windows: uses %APPDATA%/9router
 *  - Default: ~/.9router on Unix
 *
 * Strategy: tests the logic inline (the function is not exported on master,
 * so we replicate the expected behavior and validate it here as a spec).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "node:path";

// Replicate the getUserDataDir logic from the fix branch (src/lib/dataDir.js)
// This serves as the test spec for expected behavior.
function getUserDataDir({ platform, homedir, env, existsSync }) {
  const APP_NAME = "9router";

  if (env.DATA_DIR) return env.DATA_DIR;

  if (platform === "win32") {
    return path.join(
      env.APPDATA || path.join(homedir, "AppData", "Roaming"),
      APP_NAME
    );
  }

  // Unix (Linux & macOS): check XDG_CONFIG_HOME
  const legacyDir = path.join(homedir, `.${APP_NAME}`);

  if (env.XDG_CONFIG_HOME) {
    const xdgDir = path.join(env.XDG_CONFIG_HOME, APP_NAME);
    // Backward compat: prefer legacy path if it exists and XDG path doesn't
    if (!existsSync(xdgDir) && existsSync(legacyDir)) {
      return legacyDir;
    }
    return xdgDir;
  }

  return legacyDir;
}

describe("getUserDataDir", () => {
  const defaultCtx = {
    platform: "linux",
    homedir: "/home/testuser",
    env: {},
    existsSync: () => false,
  };

  describe("DATA_DIR env var", () => {
    it("uses DATA_DIR when set", () => {
      const result = getUserDataDir({
        ...defaultCtx,
        env: { DATA_DIR: "/custom/data" },
      });
      expect(result).toBe("/custom/data");
    });

    it("DATA_DIR takes priority over XDG_CONFIG_HOME", () => {
      const result = getUserDataDir({
        ...defaultCtx,
        env: {
          DATA_DIR: "/custom/data",
          XDG_CONFIG_HOME: "/home/testuser/.config",
        },
      });
      expect(result).toBe("/custom/data");
    });

    it("DATA_DIR takes priority on Windows", () => {
      const result = getUserDataDir({
        platform: "win32",
        homedir: "C:\\Users\\test",
        env: { DATA_DIR: "D:\\custom\\data", APPDATA: "C:\\Users\\test\\AppData\\Roaming" },
        existsSync: () => false,
      });
      expect(result).toBe("D:\\custom\\data");
    });
  });

  describe("XDG_CONFIG_HOME support (Linux/macOS)", () => {
    it("uses XDG_CONFIG_HOME/9router when set", () => {
      const result = getUserDataDir({
        ...defaultCtx,
        env: { XDG_CONFIG_HOME: "/home/testuser/.config" },
        existsSync: () => false,
      });
      expect(result).toBe(
        path.join("/home/testuser/.config", "9router")
      );
    });

    it("falls back to legacy dir if XDG path does not exist but legacy does", () => {
      const existsSync = (p) => {
        if (p === path.join("/home/testuser", ".9router")) return true;
        return false; // XDG path doesn't exist
      };
      const result = getUserDataDir({
        ...defaultCtx,
        env: { XDG_CONFIG_HOME: "/home/testuser/.config" },
        existsSync,
      });
      expect(result).toBe(
        path.join("/home/testuser", ".9router")
      );
    });

    it("uses XDG path when both XDG and legacy dirs exist", () => {
      const existsSync = () => true; // Both exist
      const result = getUserDataDir({
        ...defaultCtx,
        env: { XDG_CONFIG_HOME: "/home/testuser/.config" },
        existsSync,
      });
      expect(result).toBe(
        path.join("/home/testuser/.config", "9router")
      );
    });

    it("uses XDG path when neither exists (new install)", () => {
      const existsSync = () => false;
      const result = getUserDataDir({
        ...defaultCtx,
        env: { XDG_CONFIG_HOME: "/home/testuser/.config" },
        existsSync,
      });
      expect(result).toBe(
        path.join("/home/testuser/.config", "9router")
      );
    });
  });

  describe("Windows platform", () => {
    it("uses APPDATA on Windows", () => {
      const result = getUserDataDir({
        platform: "win32",
        homedir: "C:\\Users\\test",
        env: { APPDATA: "C:\\Users\\test\\AppData\\Roaming" },
        existsSync: () => false,
      });
      expect(result).toBe(
        path.join("C:\\Users\\test\\AppData\\Roaming", "9router")
      );
    });

    it("falls back to homedir/AppData/Roaming on Windows without APPDATA", () => {
      const result = getUserDataDir({
        platform: "win32",
        homedir: "C:\\Users\\test",
        env: {},
        existsSync: () => false,
      });
      expect(result).toBe(
        path.join("C:\\Users\\test", "AppData", "Roaming", "9router")
      );
    });

    it("does not use XDG_CONFIG_HOME on Windows", () => {
      const result = getUserDataDir({
        platform: "win32",
        homedir: "C:\\Users\\test",
        env: {
          APPDATA: "C:\\Users\\test\\AppData\\Roaming",
          XDG_CONFIG_HOME: "C:\\Users\\test\\.config",
        },
        existsSync: () => false,
      });
      // Should use APPDATA, not XDG
      expect(result).toBe(
        path.join("C:\\Users\\test\\AppData\\Roaming", "9router")
      );
    });
  });

  describe("default (no env vars)", () => {
    it("uses ~/.9router on Linux", () => {
      const result = getUserDataDir(defaultCtx);
      expect(result).toBe(
        path.join("/home/testuser", ".9router")
      );
    });

    it("uses ~/.9router on macOS", () => {
      const result = getUserDataDir({
        ...defaultCtx,
        platform: "darwin",
        homedir: "/Users/testuser",
      });
      expect(result).toBe(
        path.join("/Users/testuser", ".9router")
      );
    });
  });
});
