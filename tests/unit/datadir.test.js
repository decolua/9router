import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "module";
import fs from "fs";
import os from "os";
import path from "path";

const require = createRequire(import.meta.url);

const APP_NAME = "9router";
const tmpRoots = [];

function expectedDefaultDir() {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), APP_NAME);
  }
  return path.join(os.homedir(), `.${APP_NAME}`);
}

function mkTempDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpRoots.push(dir);
  return dir;
}

afterEach(() => {
  while (tmpRoots.length) {
    const dir = tmpRoots.pop();
    try {
      // Restore permissions in case a fixture made the tree read-only.
      fs.chmodSync(dir, 0o700);
      for (const entry of fs.readdirSync(dir)) {
        const p = path.join(dir, entry);
        try { if (fs.statSync(p).isDirectory()) fs.chmodSync(p, 0o700); } catch {}
      }
    } catch {}
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function withDataDirEnv(dataDir, fn) {
  const oldDataDir = process.env.DATA_DIR;
  if (dataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = dataDir;
  const restore = () => {
    if (oldDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = oldDataDir;
  };
  let result;
  try {
    result = fn();
  } catch (e) {
    restore();
    throw e;
  }
  if (result && typeof result.then === "function") return result.finally(restore);
  restore();
  return result;
}

// ESM module under test: re-evaluated per case by resetting the module
// registry so top-level DATA_DIR does not leak between cases.
async function loadEsmDataDir() {
  vi.resetModules();
  return import("../../src/lib/dataDir.mjs");
}

// CJS module under test: bust require.cache before re-require.
function loadCjsPaths() {
  const pathsPath = require.resolve("../../src/mitm/paths.js");
  delete require.cache[pathsPath];
  return require("../../src/mitm/paths.js");
}

describe("src/lib/dataDir.mjs (ESM)", () => {
  it("throws when a configured DATA_DIR cannot be created (file as parent)", async () => {
    const root = mkTempDir("9router-datadir-file-");
    const fileParent = path.join(root, "a-file");
    fs.writeFileSync(fileParent, "not a dir");
    const configured = path.join(fileParent, "child");

    await withDataDirEnv(configured, async () => {
      await expect(loadEsmDataDir()).rejects.toThrow();
    });
  });

  it.skipIf(process.platform === "win32" || process.geteuid?.() === 0)(
    "throws when a configured DATA_DIR cannot be created (EACCES on read-only parent)",
    async () => {
      const root = mkTempDir("9router-datadir-ro-parent-");
      fs.chmodSync(root, 0o500);
      const configured = path.join(root, "child");

      await withDataDirEnv(configured, async () => {
        await expect(loadEsmDataDir()).rejects.toThrow(
          new RegExp(`DATA_DIR.*could not be created.*writable DATA_DIR`, "s")
        );
      });
    }
  );

  it.skipIf(process.platform === "win32" || process.geteuid?.() === 0)(
    "throws when a configured DATA_DIR exists but is not writable",
    async () => {
      const configured = mkTempDir("9router-datadir-ro-");
      fs.chmodSync(configured, 0o500);

      await withDataDirEnv(configured, async () => {
        await expect(loadEsmDataDir()).rejects.toThrow(
          new RegExp(`DATA_DIR.*not writable.*writable DATA_DIR`, "s")
        );
      });
    }
  );

  it("returns a valid writable configured dir as-is (creating it if needed)", async () => {
    const root = mkTempDir("9router-datadir-ok-");
    const configured = path.join(root, "nested", "data");

    await withDataDirEnv(configured, async () => {
      const { getDataDir, DATA_DIR } = await loadEsmDataDir();
      expect(getDataDir()).toBe(configured);
      expect(DATA_DIR).toBe(configured);
    });
    expect(fs.statSync(configured).isDirectory()).toBe(true);
  });

  it("returns the default dir without warning when DATA_DIR is unset", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await withDataDirEnv(undefined, async () => {
        const { getDataDir, DATA_DIR } = await loadEsmDataDir();
        expect(getDataDir()).toBe(expectedDefaultDir());
        expect(DATA_DIR).toBe(expectedDefaultDir());
      });
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe("src/mitm/paths.js (CJS)", () => {
  it("throws when a configured DATA_DIR cannot be created (file as parent)", () => {
    const root = mkTempDir("9router-mitm-file-");
    const fileParent = path.join(root, "a-file");
    fs.writeFileSync(fileParent, "not a dir");
    const configured = path.join(fileParent, "child");

    expect(() =>
      withDataDirEnv(configured, () => loadCjsPaths())
    ).toThrow();
  });

  it.skipIf(process.platform === "win32" || process.geteuid?.() === 0)(
    "throws when a configured DATA_DIR cannot be created (EACCES on read-only parent)",
    () => {
      const root = mkTempDir("9router-mitm-ro-parent-");
      fs.chmodSync(root, 0o500);
      const configured = path.join(root, "child");

      expect(() =>
        withDataDirEnv(configured, () => loadCjsPaths())
      ).toThrow(/DATA_DIR.*could not be created.*writable DATA_DIR/s);
    }
  );

  it.skipIf(process.platform === "win32" || process.geteuid?.() === 0)(
    "throws when a configured DATA_DIR exists but is not writable",
    () => {
      const configured = mkTempDir("9router-mitm-ro-");
      fs.chmodSync(configured, 0o500);

      expect(() =>
        withDataDirEnv(configured, () => loadCjsPaths())
      ).toThrow(/DATA_DIR.*not writable.*writable DATA_DIR/s);
    }
  );

  it("returns a valid writable configured dir as-is and derives MITM_DIR from it", async () => {
    const root = mkTempDir("9router-mitm-ok-");
    const configured = path.join(root, "data");

    await withDataDirEnv(configured, () => {
      const { DATA_DIR, MITM_DIR } = loadCjsPaths();
      expect(DATA_DIR).toBe(configured);
      expect(MITM_DIR).toBe(path.join(configured, "mitm"));
    });
    expect(fs.statSync(configured).isDirectory()).toBe(true);
  });

  it("returns the default dir without warning when DATA_DIR is unset", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await withDataDirEnv(undefined, () => {
        const { DATA_DIR, MITM_DIR } = loadCjsPaths();
        expect(DATA_DIR).toBe(expectedDefaultDir());
        expect(MITM_DIR).toBe(path.join(expectedDefaultDir(), "mitm"));
      });
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
