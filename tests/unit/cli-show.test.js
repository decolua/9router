// `9router show` — reads each tool's local 9router config; offline, key always masked.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const show = require("../../cli/src/cli/commands/show.js");
const tools = require("../../cli/src/cli/commands/connectTools.js");

const KEY = "sk-show-test-key-123456789";
const CTX = {
  baseUrl: "http://gw.test:20128",
  apiKey: KEY,
  model: "srv/main",
  claudeModels: { ANTHROPIC_DEFAULT_OPUS_MODEL: "srv/opus", ANTHROPIC_DEFAULT_SONNET_MODEL: "srv/sonnet" },
};

describe("9router show", () => {
  let home;
  let out;
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "9r-show-"));
    vi.spyOn(os, "homedir").mockReturnValue(home);
    vi.stubEnv("XDG_CONFIG_HOME", "");
    out = [];
    vi.spyOn(console, "log").mockImplementation((...a) => out.push(a.join(" ")));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("reports every tool as not configured on an empty home", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(await show.run([])).toBe(0);
    expect(out.filter((l) => l.includes("not configured for 9router"))).toHaveLength(tools.TOOLS.length);
    expect(fetchSpy).not.toHaveBeenCalled(); // offline
  });

  it("shows what connect wrote, for every tool, with the key masked", async () => {
    for (const t of tools.TOOLS) await t.apply(CTX);
    for (const t of tools.TOOLS) {
      const [r] = await Promise.all([show.__test__.inspect(t)]);
      expect(r.configured, t.id).toBe(true);
      expect(r.apiKey, t.id).toBe("sk-sho…6789");
      // omp lists every server model via discovery instead of a fixed id.
      expect(Object.values(r.models).join(" "), t.id).toContain(t.id === "omp" ? "discovery" : "srv/");
    }
    await show.run([]);
    const text = out.join("\n");
    expect(text).not.toContain(KEY); // the full key is never printed
    expect(text).toContain("sk-sho…6789");
  });

  it("claude: shows each tier and the base URL", async () => {
    await tools.TOOLS.find((t) => t.id === "claude").apply(CTX);
    await show.run(["claude"]);
    const text = out.join("\n");
    expect(text).toContain("http://gw.test:20128/v1");
    expect(text).toMatch(/opus\s+srv\/opus/);
    expect(text).toMatch(/sonnet\s+srv\/sonnet/);
    expect(text).not.toMatch(/haiku/); // unset tier is not invented
  });

  it("flags codex when 9router is present but not the active provider", async () => {
    const f = path.join(home, ".codex", "config.toml");
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, 'model = "gpt-6"\nmodel_provider = "openai"\n[model_providers.9router]\nbase_url = "http://gw.test/v1"\n');
    await show.run(["codex"]);
    expect(out.join("\n")).toContain("not the active provider");
  });

  it("--json is machine-readable and still masks the key", async () => {
    await tools.TOOLS.find((t) => t.id === "kilo").apply(CTX);
    await show.run(["kilo", "--json"]);
    const parsed = JSON.parse(out.join("\n"));
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ id: "kilo", configured: true, apiKey: "sk-sho…6789", models: { main: "srv/main" } });
    expect(out.join("\n")).not.toContain(KEY);
  });

  it("accepts positional names, --tools and aliases; rejects unknown names", async () => {
    expect(show.__test__.parseArgs(["claude", "--tools", "codex,kilo"]).tools).toEqual(["claude", "codex", "kilo"]);
    await show.run(["claude-code"]);
    expect(out.join("\n")).toContain("Claude Code");
    await expect(show.run(["bogus"])).rejects.toThrow(/Unknown tool/);
  });

  it("a broken config is reported and exits 1, other tools still shown", async () => {
    const f = path.join(home, ".claude", "settings.json");
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, "{ not json");
    expect(await show.run(["claude", "kilo"])).toBe(1);
    expect(out.some((l) => l.startsWith("❌ Claude Code"))).toBe(true);
    expect(out.some((l) => l.includes("Kilo Code CLI"))).toBe(true);
  });
});
