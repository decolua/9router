/**
 * The CLI-tool settings writers merged a few fields into whatever they could read
 * and wrote the result back — treating an unreadable file as an empty one:
 *
 *     let authData = {};
 *     try { authData = JSON.parse(await fs.readFile(authPath, "utf-8")); }
 *     catch { }                       // malformed? permissions? same as "absent"
 *     authData.OPENAI_API_KEY = apiKey;
 *     await fs.writeFile(authPath, JSON.stringify(authData, null, 2));
 *
 * For `config.toml` that discards every provider, MCP server and approval policy
 * the user had. Only ENOENT means "start fresh".
 *
 * The same pattern guarded `~/.codex/auth.json`, where it discarded the ChatGPT
 * OAuth tokens. `master` has since dropped that write entirely — custom providers
 * carry the key as a static header — so this now covers the one write path that
 * remains, and the helper below is tested on JSON as well as TOML because the
 * next caller to need it may not be TOML.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readExistingConfig } from "@/lib/cliTools/readExistingConfig.js";

let dir;

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-clitools-")); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe("readExistingConfig", () => {
  it("returns null when the file does not exist", async () => {
    await expect(readExistingConfig(path.join(dir, "absent.json"), JSON.parse)).resolves.toBeNull();
  });

  it("returns the parsed contents when the file is valid", async () => {
    const file = path.join(dir, "auth.json");
    await fsp.writeFile(file, JSON.stringify({ tokens: { access: "keep-me" } }));

    await expect(readExistingConfig(file, JSON.parse)).resolves.toEqual({
      tokens: { access: "keep-me" },
    });
  });

  it("throws instead of reporting an empty config when the file is malformed", async () => {
    const file = path.join(dir, "auth.json");
    await fsp.writeFile(file, '{"tokens": {"access": "keep-me"');

    await expect(readExistingConfig(file, JSON.parse)).rejects.toThrow(/refusing to overwrite it/);
    // The point of throwing: the file is still there, untouched.
    expect(fs.readFileSync(file, "utf-8")).toBe('{"tokens": {"access": "keep-me"');
  });

  it("names the file in the error so the user can fix it", async () => {
    const file = path.join(dir, "config.toml");
    await fsp.writeFile(file, "not = = toml");

    await expect(
      readExistingConfig(file, (raw) => { throw new SyntaxError(`bad TOML near ${raw.length}`); })
    ).rejects.toThrow(new RegExp(`${path.basename(file)}.*bad TOML`));
  });

  it("propagates a read failure that is not ENOENT", async () => {
    // A directory where a file is expected: EISDIR on Linux/macOS, EACCES/EISDIR on Windows.
    const asDirectory = path.join(dir, "auth.json");
    fs.mkdirSync(asDirectory);

    await expect(readExistingConfig(asDirectory, JSON.parse)).rejects.toThrow();
  });

  it("does not swallow a parser that returns undefined", async () => {
    const file = path.join(dir, "empty.json");
    await fsp.writeFile(file, "");

    // An empty file parses to undefined for some parsers — still not "absent".
    await expect(readExistingConfig(file, () => undefined)).resolves.toBeUndefined();
  });
});

describe("codex-settings uses it on the config write path", () => {
  it("no longer treats an unreadable config as empty", () => {
    const src = fs.readFileSync(
      new URL("../../src/app/api/cli-tools/codex-settings/route.js", import.meta.url),
      "utf8"
    );

    expect(src).toContain("readExistingConfig(configPath");
    expect(src).not.toContain("catch { /* No existing config */ }");
    // The auth.json write this once also guarded is gone from master; assert it
    // stays gone rather than silently re-acquiring the empty-catch it had.
    expect(src).not.toContain("catch { /* No existing auth */ }");
  });
});
