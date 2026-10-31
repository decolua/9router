import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import {
  PROFILE_NAME_RE,
  isValidProfileName,
  resolveHermesHome,
  isProfileHome,
  listProfiles,
} from "../../src/app/api/cli-tools/hermes-settings/hermesProfiles.js";

const BASE = "http://127.0.0.1:20128/v1";
const NINE_ROUTER_MODEL = `model:\n  default: "anthropic/claude-sonnet-4-6"\n  provider: "custom"\n  base_url: "${BASE}"\n  api_key: \${OPENAI_API_KEY}\n`;

let tmpRoot;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hermes-profiles-test-"));
});

afterEach(async () => {
  if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true });
});

const write = (dir, file, content) => fs.writeFile(path.join(dir, file), content, "utf-8");

describe("hermes profile resolution", () => {
  describe("isValidProfileName", () => {
    it("accepts inert names", () => {
      for (const name of ["coder", "research-bot", "a", "A1_b2", "x".repeat(64)]) {
        expect(isValidProfileName(name)).toBe(true);
      }
    });

    it("rejects traversal, separators and junk", () => {
      for (const name of ["", "  ", "../evil", "..", "a/b", "a\\b", "foo.bar", "x".repeat(65), "-lead", null, undefined, 42]) {
        expect(isValidProfileName(name)).toBe(false);
      }
      // "default" is handled as the install root, not a named profile
      expect(isValidProfileName("default")).toBe(false);
    });

    it("exposes the pattern used by the directory scan", () => {
      expect(PROFILE_NAME_RE.test("coder")).toBe(true);
      expect(PROFILE_NAME_RE.test("../coder")).toBe(false);
    });
  });

  describe("resolveHermesHome", () => {
    it("maps empty/undefined/default to the install root", () => {
      for (const input of [null, undefined, "", "  ", "default"]) {
        const home = resolveHermesHome(input, tmpRoot);
        expect(home).toMatchObject({ name: "default", dir: tmpRoot, isDefault: true });
        expect(home.configPath).toBe(path.join(tmpRoot, "config.yaml"));
        expect(home.envPath).toBe(path.join(tmpRoot, ".env"));
      }
    });

    it("maps a named profile to profiles/<name>", () => {
      const home = resolveHermesHome("coder", tmpRoot);
      expect(home).toMatchObject({ name: "coder", dir: path.join(tmpRoot, "profiles", "coder"), isDefault: false });
      expect(home.configPath).toBe(path.join(tmpRoot, "profiles", "coder", "config.yaml"));
      expect(home.envPath).toBe(path.join(tmpRoot, "profiles", "coder", ".env"));
    });

    it("trims the incoming name", () => {
      expect(resolveHermesHome("  coder  ", tmpRoot).name).toBe("coder");
    });

    it("throws on invalid names instead of touching the filesystem", () => {
      for (const name of ["../evil", "a/b", "foo.bar", "x".repeat(65)]) {
        expect(() => resolveHermesHome(name, tmpRoot)).toThrow(/Invalid Hermes profile name/);
      }
    });

    it("keeps every resolved path inside the hermes root", () => {
      const home = resolveHermesHome("coder", tmpRoot);
      expect(home.dir.startsWith(path.resolve(tmpRoot))).toBe(true);
    });
  });

  describe("isProfileHome", () => {
    it("accepts a directory carrying any identity file", async () => {
      for (const file of ["config.yaml", ".env", "SOUL.md", "profile.yaml", "auth.json", "state.db"]) {
        const dir = path.join(tmpRoot, file.replace(/\W/g, "_"));
        await fs.mkdir(dir, { recursive: true });
        await write(dir, file, "");
        expect(await isProfileHome(dir)).toBe(true);
      }
    });

    it("ignores a bare directory (logging/cron leftovers)", async () => {
      const dir = path.join(tmpRoot, "bare");
      await fs.mkdir(dir, { recursive: true });
      await write(dir, "out.log", "noise");
      expect(await isProfileHome(dir)).toBe(false);
    });
  });

  describe("listProfiles", () => {
    it("returns only the default profile when there is no profiles dir", async () => {
      const profiles = await listProfiles(tmpRoot);
      expect(profiles).toHaveLength(1);
      expect(profiles[0]).toMatchObject({ name: "default", isDefault: true, command: "hermes", alias: null });
    });

    it("lists recognised profiles and skips bare/invalid directories", async () => {
      await write(tmpRoot, "config.yaml", NINE_ROUTER_MODEL);

      const coder = path.join(tmpRoot, "profiles", "coder");
      await fs.mkdir(coder, { recursive: true });
      await write(coder, "config.yaml", 'model:\n  provider: openrouter\n  default: anthropic/claude-opus-4.7\n');
      await write(coder, "profile.yaml", "display_name: Coder Bot\n");

      const research = path.join(tmpRoot, "profiles", "research");
      await fs.mkdir(research, { recursive: true });
      await write(research, "SOUL.md", "You are a researcher.");

      const bare = path.join(tmpRoot, "profiles", "bare");
      await fs.mkdir(bare, { recursive: true });
      await write(bare, "out.log", "noise");

      const invalid = path.join(tmpRoot, "profiles", "Bad.Name");
      await fs.mkdir(invalid, { recursive: true });
      await write(invalid, "config.yaml", NINE_ROUTER_MODEL);

      const profiles = await listProfiles(tmpRoot);
      const names = profiles.map((p) => p.name);
      expect(names).toEqual(["default", "coder", "research"]);

      const defaultEntry = profiles[0];
      expect(defaultEntry).toMatchObject({ isDefault: true, has9Router: true, model: "anthropic/claude-sonnet-4-6", baseUrl: BASE });

      const coderEntry = profiles[1];
      expect(coderEntry).toMatchObject({
        name: "coder",
        isDefault: false,
        displayName: "Coder Bot",
        command: "hermes -p coder",
        alias: "coder",
        model: "anthropic/claude-opus-4.7",
        has9Router: false,
      });

      expect(profiles[2]).toMatchObject({ name: "research", model: null, has9Router: false });
    });

    it("reports 9router config in a named profile", async () => {
      const coder = path.join(tmpRoot, "profiles", "coder");
      await fs.mkdir(coder, { recursive: true });
      await write(coder, "config.yaml", NINE_ROUTER_MODEL);

      const profiles = await listProfiles(tmpRoot);
      const coderEntry = profiles.find((p) => p.name === "coder");
      expect(coderEntry.has9Router).toBe(true);
      expect(coderEntry.baseUrl).toBe(BASE);
    });
  });
});
