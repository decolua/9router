/**
 * Back-compat guards for the 9router → 10router rebrand.
 *
 * The rebrand renamed the product, the npm package and the outbound wire identifiers,
 * but deliberately did NOT rename two classes of string:
 *
 *  1. The on-disk data directory — `~/.9router` (POSIX) / `%APPDATA%\9router` (Windows).
 *     Renaming it would orphan every existing install's DB, OAuth tokens and usage log.
 *  2. Env var names — `TENROUTER_*` is the preferred spelling, but the legacy
 *     `NINEROUTER_*` names must keep working for existing deployments.
 *
 * These tests pin that decision so a future "finish the rebrand" sweep fails loudly
 * instead of silently moving user data.
 */

import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const ORIGINAL_PLATFORM = process.platform;

function setPlatform(value) {
  Object.defineProperty(process, "platform", { value, configurable: true });
}

describe("data dir stays `.9router` after the rebrand", () => {
  let savedDataDir;
  let savedAppData;

  beforeEach(() => {
    savedDataDir = process.env.DATA_DIR;
    savedAppData = process.env.APPDATA;
    delete process.env.DATA_DIR;
  });

  afterEach(() => {
    setPlatform(ORIGINAL_PLATFORM);
    if (savedDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = savedDataDir;
    if (savedAppData === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = savedAppData;
  });

  it("defaults to ~/.9router on POSIX (NOT ~/.10router)", async () => {
    if (ORIGINAL_PLATFORM === "win32") return; // covered by the win32 case below
    const { getDataDir } = await import("@/lib/dataDir.js");
    expect(getDataDir()).toBe(path.join(os.homedir(), ".9router"));
  });

  it("defaults to %APPDATA%/9router on Windows (NOT 10router)", async () => {
    const { getDataDir } = await import("@/lib/dataDir.js");
    setPlatform("win32");
    process.env.APPDATA = path.join(os.tmpdir(), "appdata-fixture");
    expect(getDataDir()).toBe(path.join(process.env.APPDATA, "9router"));
  });

  it("derives the sqlite paths from the legacy data dir", async () => {
    if (ORIGINAL_PLATFORM === "win32") return;
    const { DATA_FILE, DB_DIR } = await import("@/lib/db/paths.js");
    // DATA_DIR is captured at module load, so only assert when the suite runs unpinned.
    if (savedDataDir === undefined) {
      expect(DB_DIR).toBe(path.join(os.homedir(), ".9router", "db"));
      expect(DATA_FILE).toBe(path.join(os.homedir(), ".9router", "db", "data.sqlite"));
    }
  });
});

describe("env vars are dual-accept (TENROUTER_* preferred, NINEROUTER_* legacy)", () => {
  const CONFIG_URL = pathToFileURL(
    path.resolve(new URL(".", import.meta.url).pathname, "../../next.config.mjs"),
  ).href;
  let counter = 0;
  let saved;

  async function loadConfig() {
    // Fresh module instance per case: the env is read at module scope.
    return (await import(`${CONFIG_URL}?rebrand=${counter++}`)).default;
  }

  beforeEach(() => {
    saved = {
      ten: process.env.TENROUTER_PROXY_CLIENT_MAX_BODY_SIZE,
      nine: process.env.NINEROUTER_PROXY_CLIENT_MAX_BODY_SIZE,
    };
    delete process.env.TENROUTER_PROXY_CLIENT_MAX_BODY_SIZE;
    delete process.env.NINEROUTER_PROXY_CLIENT_MAX_BODY_SIZE;
  });

  afterEach(() => {
    for (const [key, name] of [
      ["ten", "TENROUTER_PROXY_CLIENT_MAX_BODY_SIZE"],
      ["nine", "NINEROUTER_PROXY_CLIENT_MAX_BODY_SIZE"],
    ]) {
      if (saved[key] === undefined) delete process.env[name];
      else process.env[name] = saved[key];
    }
  });

  it("uses the default when neither name is set", async () => {
    const config = await loadConfig();
    expect(config.experimental.proxyClientMaxBodySize).toBe("128mb");
  });

  it("honors the new TENROUTER_* name", async () => {
    process.env.TENROUTER_PROXY_CLIENT_MAX_BODY_SIZE = "64mb";
    const config = await loadConfig();
    expect(config.experimental.proxyClientMaxBodySize).toBe("64mb");
  });

  it("still honors the legacy NINEROUTER_* name", async () => {
    process.env.NINEROUTER_PROXY_CLIENT_MAX_BODY_SIZE = "32mb";
    const config = await loadConfig();
    expect(config.experimental.proxyClientMaxBodySize).toBe("32mb");
  });

  it("prefers TENROUTER_* when both are set", async () => {
    process.env.TENROUTER_PROXY_CLIENT_MAX_BODY_SIZE = "16mb";
    process.env.NINEROUTER_PROXY_CLIENT_MAX_BODY_SIZE = "256mb";
    const config = await loadConfig();
    expect(config.experimental.proxyClientMaxBodySize).toBe("16mb");
  });
});
