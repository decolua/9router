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

  it("serverModel extractors read only 9router-owned model ids", async () => {
    expect(await tool("codex").serverModel({ config: 'model = "a"\nmodel_provider = "9router"\n' })).toBe("a");
    // A model belonging to another provider is not ours to inherit.
    expect(await tool("codex").serverModel({ config: 'model = "gpt-6"\nmodel_provider = "openai"\n' })).toBeNull();
    expect(await tool("codex").serverModel({ config: null })).toBeNull();
    expect(tool("opencode").serverModel({ config: { model: "9router/b" } })).toBe("b");
    expect(tool("opencode").serverModel({ config: { model: "anthropic/c" } })).toBeNull();
    expect(tool("droid").serverModel({ settings: { customModels: [{ id: "x", model: "n" }] } })).toBeNull();
    expect(tool("crush").serverModel({ config: { providers: { "9router": { models: [{ id: "d" }] } } } })).toBe("d");
    expect(tool("cline").serverModel({ settings: { actModeApiProvider: "cline", openAiModelId: "e" } })).toBeNull();
    expect(tool("kilo").serverModel).toBeUndefined();
    expect(tool("pi").serverModel({ config: { providers: { "9router": { models: [{ id: "f" }] } } } })).toBe("f");
    expect(tool("pi").serverModel({ config: { providers: { other: { models: [{ id: "f" }] } } } })).toBeNull();
  });

  it("pi keeps other providers and writes the 9router model list", async () => {
    const f = path.join(home, ".pi", "agent", "models.json");
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify({ providers: { mine: { baseUrl: "http://x" } } }));
    await tool("pi").apply(CTX);
    const p = readJson(f).providers;
    expect(p.mine).toEqual({ baseUrl: "http://x" });
    expect(p["9router"]).toMatchObject({ baseUrl: "http://gw.test:20128/v1", apiKey: CTX.apiKey, api: "openai-completions" });
    expect(p["9router"].models.map((m) => m.id)).toEqual([CTX.model]);
    await tool("pi").reset();
    expect(readJson(f)).toEqual({ providers: { mine: { baseUrl: "http://x" } } });
  });

  it("pi uses a legacy ~/.pi/models.json when only that exists", async () => {
    const legacy = path.join(home, ".pi", "models.json");
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    fs.writeFileSync(legacy, "{}");
    expect(await tool("pi").apply(CTX)).toEqual([legacy]);
  });

  it("omp writes a proxy-discovery provider to models.yml, keeps other YAML", async () => {
    const f = path.join(home, ".omp", "agent", "models.yml");
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, "providers:\n  mine:\n    baseUrl: http://x\ntheme: dark\n");
    await tool("omp").apply(CTX);
    const text = fs.readFileSync(f, "utf8");
    expect(text).toContain("theme: dark");
    expect(text).toMatch(/9router:\n\s+baseUrl: http:\/\/gw\.test:20128\/v1/);
    expect(text).toMatch(/discovery:\n\s+type: proxy/);
    await tool("omp").reset();
    const after = fs.readFileSync(f, "utf8");
    expect(after).not.toContain("9router");
    expect(after).toContain("mine:");
    expect(after).toContain("theme: dark");
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

  // Fake server: the operator's own model choices differ from the CLI defaults,
  // and its cli-tools config carries ITS own API key (must never be copied here).
  const SERVER_KEY = "sk-server-side-key-9999";
  const MY_KEY = "sk-mine-0000000000000";
  function mockServer() {
    const json = (body) => Promise.resolve(new Response(JSON.stringify(body), {
      status: 200, headers: { "content-type": "application/json", "set-cookie": "auth_token=t; Path=/" },
    }));
    return vi.spyOn(globalThis, "fetch").mockImplementation((url) => {
      const u = String(url);
      if (u.endsWith("/api/auth/login")) return json({ success: true });
      if (u.endsWith("/api/keys")) return json({ keys: [{ name: `cli-${os.hostname()}`, key: MY_KEY, isActive: true }] });
      if (u.endsWith("/api/cli-tools/claude-settings")) {
        return json({ installed: true, settings: { env: {
          ANTHROPIC_BASE_URL: "http://127.0.0.1:20128/v1",
          ANTHROPIC_AUTH_TOKEN: SERVER_KEY,
          ANTHROPIC_DEFAULT_OPUS_MODEL: "srv/opus",
          ANTHROPIC_DEFAULT_SONNET_MODEL: "srv/sonnet[1m]",
        } } });
      }
      if (u.endsWith("/api/cli-tools/opencode-settings")) {
        return json({ installed: true, config: { model: "9router/srv/default", provider: { "9router": { options: { apiKey: SERVER_KEY } } } } });
      }
      if (u.endsWith("/v1/models")) return json({ data: [{ id: "srv/opus" }, { id: "srv/sonnet" }, { id: "srv/default" }] });
      return json({});
    });
  }

  it("takes models from the server — nothing hardcoded", async () => {
    mockServer();
    expect(await connect.run(["http://gw.test", "--password", "x", "--tools", "claude,opencode"])).toBe(0);

    const env = readJson(path.join(home, ".claude", "settings.json")).env;
    expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe("srv/opus");
    expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe("srv/sonnet[1m]");
    // Tiers the server leaves unset stay unset — no invented model id.
    expect(env).not.toHaveProperty("ANTHROPIC_DEFAULT_HAIKU_MODEL");
    expect(env).not.toHaveProperty("ANTHROPIC_DEFAULT_FABLE_MODEL");
    expect(readJson(path.join(home, ".config", "opencode", "opencode.json")).model).toBe("9router/srv/default");

    // The server's own key and loopback base URL must not leak into our config.
    const written = fs.readFileSync(path.join(home, ".claude", "settings.json"), "utf8");
    expect(written).toContain(MY_KEY);
    expect(written).not.toContain(SERVER_KEY);
    expect(env.ANTHROPIC_BASE_URL).toBe("http://gw.test/v1");
    // The "[1m]" marker is stripped before the availability check, and unset
    // tiers aren't checked at all, so this run draws no warning.
    const warnings = console.log.mock.calls.map((c) => c[0]).filter((l) => String(l).includes("not listed by server"));
    expect(warnings).toEqual([]);
  });

  it("clears a stale Claude tier the server no longer sets", async () => {
    const f = path.join(home, ".claude", "settings.json");
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify({ env: { ANTHROPIC_DEFAULT_HAIKU_MODEL: "old/haiku", KEEP: "1" } }));
    mockServer();
    await connect.run(["http://gw.test", "--password", "x", "--tools", "claude"]);
    const env = readJson(f).env;
    expect(env).not.toHaveProperty("ANTHROPIC_DEFAULT_HAIKU_MODEL");
    expect(env.KEEP).toBe("1");
  });

  it("each tool inherits its OWN server model, falling back to OpenCode's", async () => {
    const fetchSpy = mockServer();
    const base = fetchSpy.getMockImplementation();
    const json = (b) => Promise.resolve(new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } }));
    fetchSpy.mockImplementation((url) => {
      const u = String(url);
      // Server-side configs also hold the server's key — must be ignored.
      if (u.endsWith("/api/cli-tools/codex-settings")) {
        return json({ installed: true, config: `model = "srv/codex"\nmodel_provider = "9router"\n[model_providers.9router]\nhttp_headers = { Authorization = "Bearer ${SERVER_KEY}" }\n` });
      }
      if (u.endsWith("/api/cli-tools/droid-settings")) {
        return json({ installed: true, settings: { customModels: [{ id: "mine", model: "x" }, { id: "custom:9Router-0", model: "srv/droid", apiKey: SERVER_KEY }] } });
      }
      if (u.endsWith("/api/cli-tools/cline-settings")) {
        return json({ installed: true, settings: { actModeApiProvider: "openai", openAiModelId: "srv/cline" } });
      }
      if (u.endsWith("/api/cli-tools/crush-settings")) return json({ installed: false, config: null });
      return base(url);
    });

    expect(await connect.run(["http://gw.test", "--password", "x", "--tools", "codex,droid,cline,crush,kilo"])).toBe(0);

    expect(fs.readFileSync(path.join(home, ".codex", "config.toml"), "utf8")).toContain('model = "srv/codex"');
    expect(readJson(path.join(home, ".factory", "settings.json")).customModels[0].model).toBe("srv/droid");
    expect(readJson(path.join(home, ".cline", "data", "globalState.json")).openAiModelId).toBe("srv/cline");
    // crush (not installed on server) and kilo (no model exposed) fall back to OpenCode's model.
    expect(readJson(path.join(home, ".config", "crush", "crush.json")).providers["9router"].models[0].id).toBe("srv/default");
    expect(readJson(path.join(home, ".local", "share", "kilo", "auth.json"))["openai-compatible"].model).toBe("srv/default");

    for (const f of [
      path.join(home, ".codex", "config.toml"),
      path.join(home, ".factory", "settings.json"),
      path.join(home, ".cline", "data", "secrets.json"),
    ]) {
      const text = fs.readFileSync(f, "utf8");
      expect(text).toContain(MY_KEY);
      expect(text).not.toContain(SERVER_KEY);
    }
  });

  it("omp needs no model: configured even when the server has none", async () => {
    unreadableServer();
    expect(await connect.run(["http://gw.test", "--password", "x", "--tools", "omp"])).toBe(0);
    const text = fs.readFileSync(path.join(home, ".omp", "agent", "models.yml"), "utf8");
    expect(text).toContain(MY_KEY);
    expect(text).not.toContain(SERVER_KEY);
  });

  it("--model overrides every non-Claude tool's server value", async () => {
    mockServer();
    await connect.run(["http://gw.test", "--password", "x", "--tools", "opencode,kilo", "--model", "mine/all"]);
    expect(readJson(path.join(home, ".config", "opencode", "opencode.json")).model).toBe("9router/mine/all");
    expect(readJson(path.join(home, ".local", "share", "kilo", "auth.json"))["openai-compatible"].model).toBe("mine/all");
  });

  it("an explicit tier flag beats the server's value", async () => {
    mockServer();
    await connect.run(["http://gw.test", "--password", "x", "--tools", "claude", "--opus", "mine/opus"]);
    expect(readJson(path.join(home, ".claude", "settings.json")).env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe("mine/opus");
  });

  it("--no-inherit is no longer accepted", async () => {
    await expect(connect.run(["http://gw.test", "--no-inherit"])).rejects.toThrow(/Unknown option/);
  });

  function unreadableServer() {
    return mockServer().mockImplementation((url) => {
      const u = String(url);
      const json = (b, h) => Promise.resolve(new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json", ...h } }));
      if (u.endsWith("/api/auth/login")) return json({ success: true }, { "set-cookie": "auth_token=t" });
      if (u.endsWith("/api/keys")) return json({ keys: [{ name: `cli-${os.hostname()}`, key: MY_KEY, isActive: true }] });
      if (u.includes("/api/cli-tools/")) return Promise.resolve(new Response("nope", { status: 500 }));
      return json({ data: [] });
    });
  }

  it("server config unreadable: Claude still gets URL + key, tiers left unset", async () => {
    unreadableServer();
    expect(await connect.run(["http://gw.test", "--password", "x", "--tools", "claude"])).toBe(0);
    const env = readJson(path.join(home, ".claude", "settings.json")).env;
    expect(env.ANTHROPIC_BASE_URL).toBe("http://gw.test/v1");
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe(MY_KEY);
    for (const m of tools.CLAUDE_MODELS) expect(env).not.toHaveProperty(m.envKey);
  });

  it("a non-Claude tool with no model anywhere is skipped and exits 1", async () => {
    unreadableServer();
    expect(await connect.run(["http://gw.test", "--password", "x", "--tools", "opencode"])).toBe(1);
    expect(fs.existsSync(path.join(home, ".config", "opencode", "opencode.json"))).toBe(false);
    expect(console.log.mock.calls.map((c) => c[0]).some((l) => String(l).includes("skipped"))).toBe(true);
    // ...unless the user says which model to use.
    expect(await connect.run(["http://gw.test", "--password", "x", "--tools", "opencode", "--model", "mine/m"])).toBe(0);
    expect(readJson(path.join(home, ".config", "opencode", "opencode.json")).model).toBe("9router/mine/m");
  });

  // savedEnvPath() reads %APPDATA% on Windows, not homedir(), so point both at
  // the temp home — otherwise these tests write into the real user profile.
  const isolateDataDir = () => {
    vi.stubEnv("DATA_DIR", "");
    vi.stubEnv("APPDATA", path.join(home, "AppData", "Roaming"));
  };
  const expectedEnvPath = () => (process.platform === "win32"
    ? path.join(home, "AppData", "Roaming", "9router", "connect.env")
    : path.join(home, ".9router", "connect.env"));

  it("--save stores the password (mode 600) bound to the server, and later runs reuse it", async () => {
    isolateDataDir();
    vi.stubEnv("NINE_ROUTER_PASSWORD", "");
    const fetchSpy = mockServer();
    expect(await connect.run(["http://gw.test", "--password", "s3cr\"et", "--save", "--tools", "claude"])).toBe(0);
    const file = connect.__test__.savedEnvPath();
    expect(file).toBe(expectedEnvPath());
    expect(file.startsWith(home)).toBe(true);
    if (process.platform !== "win32") expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(connect.__test__.loadSavedPassword("http://gw.test")).toBe("s3cr\"et");
    // Bound to its server: never offered to another host.
    expect(connect.__test__.loadSavedPassword("http://evil.test")).toBe(null);

    fetchSpy.mockClear();
    expect(await connect.run(["http://gw.test", "--tools", "claude"])).toBe(0);
    const loginCall = fetchSpy.mock.calls.find(([u]) => String(u).endsWith("/api/auth/login"));
    expect(JSON.parse(loginCall[1].body).password).toBe("s3cr\"et");
    vi.unstubAllEnvs();
  });

  it("without --save nothing is written", async () => {
    isolateDataDir();
    mockServer();
    expect(await connect.run(["http://gw.test", "--password", "x", "--tools", "claude"])).toBe(0);
    expect(fs.existsSync(connect.__test__.savedEnvPath())).toBe(false);
    vi.unstubAllEnvs();
  });

  it("a hand-edited saved file with a bare value doesn't crash", async () => {
    isolateDataDir();
    const file = expectedEnvPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "NINE_ROUTER_SERVER=http://gw.test\nNINE_ROUTER_PASSWORD=bare-value\n");
    expect(connect.__test__.loadSavedPassword("http://gw.test")).toBe("bare-value");
    vi.unstubAllEnvs();
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
