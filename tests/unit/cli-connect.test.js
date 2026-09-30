// `9router connect` — arg parsing, URL/cookie helpers and per-tool config writers.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const connect = require("../../cli/src/cli/commands/connect.js");
const tools = require("../../cli/src/cli/commands/connectTools.js");
const { parseArgs, normalizeServerUrl, extractAuthCookie, maskKey } = connect.__test__;
const { stripTrailingCommas } = tools.__test__;

const CTX = {
  baseUrl: "http://gw.test:20128",
  apiKey: "sk-unit-test-key-0000",
  model: "cc/claude-opus-5",
  claudeModels: { ANTHROPIC_DEFAULT_OPUS_MODEL: "cc/claude-opus-5" },
};
const tool = (id) => tools.TOOLS.find((t) => t.id === id);
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

describe("connect helpers", () => {
  it("parseArgs reads url, tools, model and claude tier overrides", () => {
    const o = parseArgs(["http://h:1", "--tools", "claude,codex", "--model", "m1", "--opus", "o1", "--password", "p"]);
    expect(o.url).toBe("http://h:1");
    expect(o.tools).toEqual(["claude", "codex"]);
    expect(o.model).toBe("m1");
    expect(o.models).toEqual({ opus: "o1" });
    expect(o.password).toBe("p");
  });

  it("parseArgs rejects unknown options and missing values", () => {
    expect(() => parseArgs(["--nope"])).toThrow(/Unknown option/);
    expect(() => parseArgs(["--tools"])).toThrow(/Missing value/);
  });

  it("normalizeServerUrl keeps only the origin and defaults to http", () => {
    expect(normalizeServerUrl("http://h:20128/dashboard/cli-tools")).toBe("http://h:20128");
    expect(normalizeServerUrl("h:20128")).toBe("http://h:20128");
    expect(normalizeServerUrl("https://h/v1/")).toBe("https://h");
  });

  it("extractAuthCookie picks auth_token from Set-Cookie", () => {
    const h = new Headers();
    h.append("set-cookie", "other=1; Path=/");
    h.append("set-cookie", "auth_token=abc.def.ghi; Path=/; HttpOnly");
    expect(extractAuthCookie(h)).toBe("auth_token=abc.def.ghi");
    expect(extractAuthCookie(new Headers())).toBeNull();
  });

  it("maskKey never reveals the middle of the key", () => {
    expect(maskKey("sk-1234567890abcdef")).toBe("sk-123…cdef");
    expect(maskKey("short")).toBe("****");
  });

  it("stripTrailingCommas leaves commas inside strings alone", () => {
    expect(JSON.parse(stripTrailingCommas('{"a":"x,}","b":[1,2,],}'))).toEqual({ a: "x,}", b: [1, 2] });
    expect(JSON.parse(stripTrailingCommas('{"a":"q\\",}",}'))).toEqual({ a: 'q",}' });
  });

  it("resolveTools handles aliases, all, and unknown names", () => {
    expect(tools.resolveTools(["claude-code", "factory"]).map((t) => t.id)).toEqual(["claude", "droid"]);
    expect(tools.resolveTools(["all"]).map((t) => t.id)).toEqual(tools.TOOL_IDS);
    expect(() => tools.resolveTools(["bogus"])).toThrow(/Unknown tool/);
  });
});

describe("connect tool writers", () => {
  let home;
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "9r-connect-"));
    vi.spyOn(os, "homedir").mockReturnValue(home);
    vi.stubEnv("XDG_CONFIG_HOME", "");
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("every tool applies then resets cleanly on an empty home", async () => {
    for (const t of tools.TOOLS) {
      const written = await t.apply(CTX);
      expect(written.length).toBeGreaterThan(0);
      // Key may live in just one of the files (cline: secrets.json).
      expect(written.some((f) => fs.readFileSync(f, "utf8").includes(CTX.apiKey))).toBe(true);
      if (process.platform !== "win32") {
        for (const f of written) expect(fs.statSync(f).mode & 0o777).toBe(0o600);
      }
      await t.reset();
      for (const f of written) expect(fs.readFileSync(f, "utf8")).not.toContain(CTX.apiKey);
    }
  });

  it("claude merges env and keeps unrelated settings; reset removes only 9router keys", async () => {
    const f = path.join(home, ".claude", "settings.json");
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify({ theme: "dark", env: { KEEP: "1" } }));
    await tool("claude").apply(CTX);
    const cfg = readJson(f);
    expect(cfg.theme).toBe("dark");
    expect(cfg.env).toMatchObject({ KEEP: "1", ANTHROPIC_BASE_URL: "http://gw.test:20128/v1", ANTHROPIC_AUTH_TOKEN: CTX.apiKey });
    expect(fs.existsSync(`${f}.bak-9router`)).toBe(true);
    await tool("claude").reset();
    expect(readJson(f)).toEqual({ theme: "dark", hasCompletedOnboarding: true, env: { KEEP: "1" } });
  });

  it("codex keeps other TOML tables and drops empty ones on reset", async () => {
    const f = path.join(home, ".codex", "config.toml");
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, '[mcp_servers.x]\ncommand = "foo"\n');
    await tool("codex").apply(CTX);
    const text = fs.readFileSync(f, "utf8");
    expect(text).toContain('model_provider = "9router"');
    expect(text).toContain("[mcp_servers.x]");
    await tool("codex").reset();
    const after = fs.readFileSync(f, "utf8");
    expect(after).toContain("[mcp_servers.x]");
    expect(after).not.toMatch(/9router|model_providers|\[agents\]/);
  });

  it("droid keeps user models and puts 9router first", async () => {
    const f = path.join(home, ".factory", "settings.json");
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify({ customModels: [{ id: "mine", model: "m" }] }));
    await tool("droid").apply(CTX);
    expect(readJson(f).customModels.map((m) => m.id)).toEqual(["custom:9Router-0", "mine"]);
    await tool("droid").reset();
    expect(readJson(f).customModels.map((m) => m.id)).toEqual(["mine"]);
  });

  it("cline uses base URL without /v1 and reset reports both files", async () => {
    await tool("cline").apply(CTX);
    const state = readJson(path.join(home, ".cline", "data", "globalState.json"));
    expect(state.openAiBaseUrl).toBe("http://gw.test:20128");
    expect((await tool("cline").reset()).length).toBe(2);
  });
});

describe("connect run()", () => {
  let home;
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "9r-connect-run-"));
    vi.spyOn(os, "homedir").mockReturnValue(home);
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("unknown tool fails before any network call", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(connect.run(["http://gw.test", "--tools", "bogus", "--password", "x"])).rejects.toThrow(/Unknown tool/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reset keeps going when one tool fails and returns 1", async () => {
    const f = path.join(home, ".codex", "config.toml");
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, "this is = = not toml [[[");
    const code = await connect.run(["--reset", "--tools", "codex,claude"]);
    expect(code).toBe(1);
    const lines = console.log.mock.calls.map((c) => c[0]);
    expect(lines.some((l) => l.startsWith("❌ OpenAI Codex CLI"))).toBe(true);
    expect(lines.some((l) => l.includes("Claude Code"))).toBe(true);
  });
});
