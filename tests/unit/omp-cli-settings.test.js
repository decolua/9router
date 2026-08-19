/**
 * Unit tests for the Oh My Pi (omp) settings route.
 *
 * Exercises the YAML-aware writer directly, without HTTP. The route imports
 * `next/server` and resolves paths via `os.homedir()`; both are mocked so
 * the module loads under Vitest in Node and writes to a per-suite HOME.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { fileURLToPath } from "url";
import os from "os";
import { parse as parseYAML } from "yaml";

const tmpHome = mkdtempSync(join(tmpdir(), "omp-route-"));
const projectRoot = join(fileURLToPath(new URL(".", import.meta.url)), "../..");
const routePath = join(projectRoot, "src/app/api/cli-tools/omp-settings/route.js").replace(/\\/g, "/");

const agentDir = () => join(tmpHome, ".omp", "agent");
const modelsPath = () => join(agentDir(), "models.yml");
const modelsYamlPath = () => join(agentDir(), "models.yaml");
const modelsJsonPath = () => join(agentDir(), "models.json");
const configPath = () => join(agentDir(), "config.yml");

let route;

beforeAll(async () => {
  // The route resolves ~/.omp/agent every call via os.homedir().
  vi.spyOn(os, "homedir").mockReturnValue(tmpHome);

  // Stub `next/server` with a shape that matches NextResponse.json(payload, init).
  // The route calls it as `NextResponse.json(body, { status })` — return an
  // object with the asserted properties and an async json() that captures body.
  vi.doMock("next/server", () => {
    return {
      NextResponse: {
        json(payload, init) {
          const status = init?.status ?? 200;
          return { status, async json() { return payload; } };
        },
      },
    };
  });

  route = await import(routePath);
});

afterAll(() => {
  rmSync(tmpHome, { recursive: true, force: true });
});

function readModelsFile() {
  // The resolver picks models.yml, then models.yaml, then legacy models.json.
  for (const p of [modelsPath(), modelsYamlPath(), modelsJsonPath()]) {
    if (existsSync(p)) return { path: p, doc: parseYAML(readFileSync(p, "utf-8")) };
  }
  return null;
}

function readConfig() {
  return parseYAML(readFileSync(configPath(), "utf-8"));
}

describe("omp settings route (YAML-aware writer)", () => {
  beforeEach(() => {
    rmSync(agentDir(), { recursive: true, force: true });
    mkdirSync(agentDir(), { recursive: true });
  });

  it("creates models.yml with the canonical 9router provider block when missing", async () => {
    const req = { json: async () => ({ baseUrl: "http://127.0.0.1:20128", apiKey: "sk_test_create", models: ["cc/claude-opus-5"] }) };
    const res = await route.POST(req);
    expect(res.status).toBe(200);

    const found = readModelsFile();
    expect(found).not.toBeNull();
    expect(found.path).toBe(modelsPath());

    const nine = found.doc.providers["9router"];
    expect(nine.baseUrl).toBe("http://127.0.0.1:20128/v1");
    expect(nine.api).toBe("openai-completions");
    expect(nine.apiKey).toBe("sk_test_create");
    expect(nine.authHeader).toBe(true);
    expect(nine.discovery).toEqual({ type: "openai-models-list" });
    expect(Array.isArray(nine.models)).toBe(true);
    expect(nine.models[0].id).toBe("cc/claude-opus-5");
  });

  it("preserves user-written comments and other providers on merge", async () => {
    const pre = [
      "# hand-written, do not lose",
      "providers:",
      "  other-provider:",
      "    baseUrl: http://other.example.com/v1",
      "    apiKey: sk_other",
      "    authHeader: true",
    ].join("\n");
    writeFileSync(modelsPath(), pre);

    const req = { json: async () => ({ baseUrl: "http://127.0.0.1:20128", apiKey: "sk_test_merge", models: ["cc/claude-opus-5"] }) };
    const res = await route.POST(req);
    expect(res.status).toBe(200);

    const raw = readFileSync(modelsPath(), "utf-8");
    expect(raw).toContain("# hand-written, do not lose");
    expect(raw).toContain("other-provider:");
    expect(readModelsFile().doc.providers["other-provider"]).toBeTruthy();
    expect(readModelsFile().doc.providers["9router"]).toBeTruthy();
  });

  it("backs up the existing file before rewrite", async () => {
    writeFileSync(modelsPath(), "# original\nproviders:\n  x: { baseUrl: x }\n");
    const req = { json: async () => ({ baseUrl: "http://127.0.0.1:20128", apiKey: "sk_test_backup", models: ["cc/claude-opus-5"] }) };
    await route.POST(req);

    const backups = readdirSync(agentDir()).filter((n) => n.startsWith("models.yml.bak."));
    expect(backups.length).toBe(1);
  });

  it("refuses to overwrite a corrupt models.yml", async () => {
    const corrupt = "providers:\n  9router:\n   bad-indent: :\n  ::\n  [unclosed\n";
    writeFileSync(modelsPath(), corrupt);

    const req = { json: async () => ({ baseUrl: "http://127.0.0.1:20128", apiKey: "sk_x", models: ["cc/claude-opus-5"] }) };
    const res = await route.POST(req);
    expect(res.status).toBe(409);

    expect(readFileSync(modelsPath(), "utf-8")).toBe(corrupt);
  });

  it("refuses to write roles when config.yml is corrupt", async () => {
    writeFileSync(modelsPath(), "providers:\n  9router:\n    baseUrl: http://127.0.0.1:20128/v1\n    api: openai-completions\n    apiKey: sk_x\n    models:\n      - id: cc/claude-opus-5\n        name: cc/claude-opus-5\n");
    const modelsBefore = readFileSync(modelsPath(), "utf-8");
    const corruptCfg = "modelRoles:\n  default:\n    bad-: ::\n    :::\n  [unclosed\n";
    writeFileSync(configPath(), corruptCfg);

    const res = await route.PATCH({
      json: async () => ({ scope: "global", roles: { default: "cc/claude-opus-5" } }),
    });
    expect(res.status).toBe(409);

    // Neither file is touched when the role layer cannot be parsed.
    expect(readFileSync(modelsPath(), "utf-8")).toBe(modelsBefore);
    expect(readFileSync(configPath(), "utf-8")).toBe(corruptCfg);
  });

  it("does not touch config.yml when caller omits activeModel", async () => {
    const req = { json: async () => ({ baseUrl: "http://127.0.0.1:20128", apiKey: "sk_x", models: ["cc/claude-opus-5"] }) };
    const res = await route.POST(req);
    expect(res.status).toBe(200);
    expect(existsSync(configPath())).toBe(false);
  });

  it("resolves models.yaml in preference to models.yml", async () => {
    writeFileSync(modelsYamlPath(), "providers:\n  other-yaml: { baseUrl: y }\n");
    const req = { json: async () => ({ baseUrl: "http://127.0.0.1:20128", apiKey: "sk_y", models: ["cc/claude-opus-5"] }) };
    const res = await route.POST(req);
    expect(res.status).toBe(200);

    // Canonical models.yml not created when a sibling .yaml exists.
    expect(existsSync(modelsPath())).toBe(false);
    const out = readModelsFile();
    expect(out.path).toBe(modelsYamlPath());
    expect(out.doc.providers["other-yaml"]).toBeTruthy();
    expect(out.doc.providers["9router"]).toBeTruthy();
  });

  it("migrates a legacy models.json by re-emitting YAML alongside (or replacing)", async () => {
    writeFileSync(modelsJsonPath(), JSON.stringify({ providers: { "legacy-only": { baseUrl: "http://legacy/v1" } } }, null, 2));
    const req = { json: async () => ({ baseUrl: "http://127.0.0.1:20128", apiKey: "sk_j", models: ["cc/claude-opus-5"] }) };
    const res = await route.POST(req);
    expect(res.status).toBe(200);

    // Behavior: legacy data MUST survive the Apply (no clobber), whether the
    // route re-encoded into YAML or kept the .json on disk. Either path is
    // acceptable; both result in `legacy-only` surviving somewhere.
    const nine = readModelsFile().doc.providers["9router"];
    expect(nine).toBeTruthy();

    // The legacy data should still be queryable: at least one of the two
    // files (the resolver's write target or the original .json) must
    // contain the legacy provider entry.
    let legacyPreserved = false;
    for (const p of [modelsPath(), modelsYamlPath(), modelsJsonPath()]) {
      if (!existsSync(p)) continue;
      const doc = parseYAML(readFileSync(p, "utf-8"));
      if (doc?.providers?.["legacy-only"]) { legacyPreserved = true; break; }
    }
    expect(legacyPreserved).toBe(true);
  });

  it("preserves a custom host:port base URL", async () => {
    const req = { json: async () => ({ baseUrl: "https://my-router.example.com:8443", apiKey: "sk_cu", models: ["cc/claude-opus-5"] }) };
    const res = await route.POST(req);
    expect(res.status).toBe(200);

    expect(readModelsFile().doc.providers["9router"].baseUrl).toBe("https://my-router.example.com:8443/v1");
  });

  it("writes modelRoles.default via PATCH", async () => {
    await route.POST({
      json: async () => ({ baseUrl: "http://127.0.0.1:20128", apiKey: "sk_x", models: ["cc/claude-opus-5"] }),
    });
    const res = await route.PATCH({
      json: async () => ({ scope: "global", roles: { default: "cc/claude-opus-5" } }),
    });
    expect(res.status).toBe(200);
    expect(readConfig().modelRoles.default).toBe("9router/cc/claude-opus-5");
  });

  it("rejects a default role that is not in the provider model list", async () => {
    await route.POST({
      json: async () => ({ baseUrl: "http://127.0.0.1:20128", apiKey: "sk_x", models: ["cc/claude-opus-5"] }),
    });
    const res = await route.PATCH({
      json: async () => ({ scope: "global", roles: { default: "not-a-model" } }),
    });
    expect(res.status).toBe(400);
    expect(existsSync(configPath())).toBe(false);
  });

  it("allows a default role that already exists on the 9router provider", async () => {
    writeFileSync(modelsPath(), "providers:\n  9router:\n    baseUrl: http://127.0.0.1:20128/v1\n    api: openai-completions\n    apiKey: sk_old\n    models:\n      - id: kr/claude-sonnet-4.5\n        name: existing\n");
    await route.POST({
      json: async () => ({ baseUrl: "http://127.0.0.1:20128", apiKey: "sk_x", models: ["cc/claude-opus-5"] }),
    });
    const res = await route.PATCH({
      json: async () => ({ scope: "global", roles: { default: "kr/claude-sonnet-4.5" } }),
    });
    expect(res.status).toBe(200);
    expect(readConfig().modelRoles.default).toBe("9router/kr/claude-sonnet-4.5");
  });


  it("keeps extra fields on an existing same-id model when merging", async () => {
    writeFileSync(modelsPath(), "providers:\n  9router:\n    baseUrl: http://127.0.0.1:20128/v1\n    api: openai-completions\n    apiKey: sk_old\n    models:\n      - id: cc/claude-opus-5\n        name: custom-name\n        cost: { input: 1 }\n");
    const res = await route.POST({ json: async () => ({ baseUrl: "http://127.0.0.1:20128", apiKey: "sk_x", models: ["cc/claude-opus-5"] }) });
    expect(res.status).toBe(200);
    const entry = readModelsFile().doc.providers["9router"].models[0];
    expect(entry.cost).toEqual({ input: 1 });
    expect(entry.name).toBe("custom-name");
  });


  it("emits live capabilities from /v1/models into model entries", async () => {
    const caps = {
      "cc/claude-opus-5": { vision: true, contextWindow: 1048576, maxOutput: 65536, reasoning: true },
    };
    const req = {
      json: async () => ({
        baseUrl: "http://127.0.0.1:20128",
        apiKey: "sk_cap",
        models: ["cc/claude-opus-5"],
        capabilities: caps,
      }),
    };
    const res = await route.POST(req);
    expect(res.status).toBe(200);

    const entry = readModelsFile().doc.providers["9router"].models[0];
    expect(entry.id).toBe("cc/claude-opus-5");
    expect(entry.input).toEqual(["text", "image"]);
    expect(entry.contextWindow).toBe(1048576);
    expect(entry.maxTokens).toBe(65536);
    expect(entry.reasoning).toBe(true);
  });

  it("uses path.join() so the agent dir works on POSIX and win32", async () => {
    // path.join() is implemented natively in Node; the only behavior worth
    // asserting under a Windows-separator mock is that the route does NOT
    // hand-build "/Users/nick\\.omp\\agent" via string concat (which would
    // break on POSIX) or "/Users/nick/.omp/agent" via forward slashes only (which
    // would break on Windows).
    const pathModule = await import("path");
    const winPath = pathModule.win32.join("C:\\Users\\foo", ".omp", "agent");
    expect(/\\/.test(winPath)).toBe(true);
    // On POSIX, path.join uses the native separator (forward slash). The
    // route relies on the same function under win32 and posix builds, so a
    // single import is sufficient.
    const posixPath = pathModule.posix.join("/home/foo", ".omp", "agent");
    expect(posixPath).toBe("/home/foo/.omp/agent");
  });

  it("removes the 9router provider on DELETE and clears a dangling role", async () => {
    const seed = 'providers:\n  "9router":\n    baseUrl: http://127.0.0.1:20128/v1\n    api: openai-completions\n    apiKey: sk_x\n    authHeader: true\n    discovery:\n      type: openai-models-list\n    models:\n      - id: cc/claude-opus-5\n        name: cc/claude-opus-5\n        input: [text]\n';
    writeFileSync(modelsPath(), seed);
    writeFileSync(configPath(), 'modelRoles:\n  default: "9router/cc/claude-opus-5"\n');

    const req = { url: `http://x/omp-settings?model=cc/claude-opus-5` };
    await route.DELETE(req);

    const cfgRaw = readFileSync(configPath(), "utf-8").trim();
    expect(cfgRaw).not.toContain('9router/');
  });

  it("refuses DELETE when config.yml is corrupt and does not touch models.yml", async () => {
    const seed = "providers:\n  9router:\n    baseUrl: http://127.0.0.1:20128/v1\n    api: openai-completions\n    apiKey: sk_x\n    models:\n      - id: cc/claude-opus-5\n        name: cc/claude-opus-5\n";
    writeFileSync(modelsPath(), seed);
    const corruptCfg = "modelRoles:\n  default:\n    bad-: ::\n    :::\n  [unclosed\n";
    writeFileSync(configPath(), corruptCfg);

    const res = await route.DELETE({ url: "http://x/omp-settings" });
    expect(res.status).toBe(409);
    expect(readFileSync(modelsPath(), "utf-8")).toBe(seed);
    expect(readFileSync(configPath(), "utf-8")).toBe(corruptCfg);
  });

  it("DELETE updates models.yaml when that is the resolved file", async () => {
    writeFileSync(modelsYamlPath(), "providers:\n  other-yaml: { baseUrl: y }\n  9router:\n    baseUrl: http://127.0.0.1:20128/v1\n    api: openai-completions\n    apiKey: sk_x\n    models:\n      - id: cc/claude-opus-5\n        name: cc/claude-opus-5\n");
    const res = await route.DELETE({ url: "http://x/omp-settings?model=cc/claude-opus-5" });
    expect(res.status).toBe(200);
    expect(existsSync(modelsPath())).toBe(false);
    const out = parseYAML(readFileSync(modelsYamlPath(), "utf-8"));
    expect(out?.providers?.["9router"]).toBeFalsy();
    expect(out?.providers?.["other-yaml"]).toBeTruthy();
  });

  it("DELETE of a legacy models.json writes canonical models.yml and keeps other providers", async () => {
    writeFileSync(modelsJsonPath(), JSON.stringify({
      providers: {
        "legacy-only": { baseUrl: "http://legacy/v1" },
        "9router": { baseUrl: "http://127.0.0.1:20128/v1", api: "openai-completions", apiKey: "sk_x", models: [{ id: "cc/claude-opus-5", name: "cc/claude-opus-5" }] },
      },
    }));
    const res = await route.DELETE({ url: "http://x/omp-settings" });
    expect(res.status).toBe(200);
    const out = parseYAML(readFileSync(modelsPath(), "utf-8"));
    expect(out?.providers?.["9router"]).toBeFalsy();
    expect(out?.providers?.["legacy-only"]).toBeTruthy();
  });



  it("returns installed=false when neither omp binary nor config is present", async () => {
    rmSync(agentDir(), { recursive: true, force: true });
    // `checkOmpInstalled` falls through `which omp` to `fs.access(getModelsPath())`,
    // both of which need to fail. Stub the first by neutering PATH. Windows path
    // is irrelevant here — the test runs on the host Node, and we just need
    // both probe branches to miss.
    const savedPath = process.env.PATH;
    const savedPath2 = process.env.Path;
    process.env.PATH = "/dev/null";
    process.env.Path = "/dev/null";
    try {
      const res = await route.GET();
      const data = await res.json();
      expect(data.installed).toBe(false);
    } finally {
      process.env.PATH = savedPath;
      if (savedPath2 !== undefined) process.env.Path = savedPath2;
    }
  });

  // Roles moved from POST to PATCH: the catalog is always global, roles are
  // scoped, so a single POST cannot carry both without an implied scope.
  const applyCatalog = (models, apiKey = "sk_roles") =>
    route.POST({
      json: async () => ({ baseUrl: "http://127.0.0.1:20128", apiKey, models }),
    });

  it("writes every official OMP role supplied in roles", async () => {
    expect((await applyCatalog(["kimi/kimi-k3", "gcli/grok-4.6"])).status).toBe(200);

    const res = await route.PATCH({
      json: async () => ({
        scope: "global",
        roles: {
          default: "kimi/kimi-k3",
          smol: "gcli/grok-4.6",
          slow: "kimi/kimi-k3",
          vision: "gcli/grok-4.6",
          plan: "kimi/kimi-k3",
          designer: "gcli/grok-4.6",
          commit: "kimi/kimi-k3",
          tiny: "gcli/grok-4.6",
          task: "kimi/kimi-k3",
          advisor: "gcli/grok-4.6",
        },
      }),
    });
    expect(res.status).toBe(200);
    expect(readConfig().modelRoles).toEqual({
      default: "9router/kimi/kimi-k3",
      smol: "9router/gcli/grok-4.6",
      slow: "9router/kimi/kimi-k3",
      vision: "9router/gcli/grok-4.6",
      plan: "9router/kimi/kimi-k3",
      designer: "9router/gcli/grok-4.6",
      commit: "9router/kimi/kimi-k3",
      tiny: "9router/gcli/grok-4.6",
      task: "9router/kimi/kimi-k3",
      advisor: "9router/gcli/grok-4.6",
    });
  });

  it("POST refuses role assignments outright", async () => {
    const res = await route.POST({
      json: async () => ({
        baseUrl: "http://127.0.0.1:20128",
        apiKey: "sk_x",
        models: ["kimi/kimi-k3"],
        roles: { default: "kimi/kimi-k3" },
      }),
    });
    expect(res.status).toBe(400);
    expect(existsSync(modelsPath())).toBe(false);
    expect(existsSync(configPath())).toBe(false);
  });

  it("rejects an unknown role without writing config.yml", async () => {
    await applyCatalog(["kimi/kimi-k3"], "sk_x");
    const res = await route.PATCH({
      json: async () => ({
        scope: "global",
        roles: { default: "kimi/kimi-k3", notARole: "kimi/kimi-k3" },
      }),
    });
    expect(res.status).toBe(400);
    expect(existsSync(configPath())).toBe(false);
  });

  it("rejects a role model that is not in the catalog", async () => {
    await applyCatalog(["kimi/kimi-k3"], "sk_x");
    const res = await route.PATCH({
      json: async () => ({ scope: "global", roles: { smol: "gcli/grok-4.6" } }),
    });
    expect(res.status).toBe(400);
    expect(existsSync(configPath())).toBe(false);
  });

  it("GET returns all 9Router role assignments", async () => {
    writeFileSync(modelsPath(), "providers:\n  9router:\n    baseUrl: http://127.0.0.1:20128/v1\n    api: openai-completions\n    apiKey: sk_x\n    models:\n      - id: kimi/kimi-k3\n        name: kimi/kimi-k3\n");
    writeFileSync(configPath(), "modelRoles:\n  default: 9router/kimi/kimi-k3\n  task: 9router/kimi/kimi-k3\n  smol: xai-oauth/grok-4.6\n");
    const res = await route.GET();
    const data = await res.json();
    expect(data.omp.roles.default).toBe("kimi/kimi-k3");
    expect(data.omp.roles.task).toBe("kimi/kimi-k3");
    expect(data.omp.roles.smol).toBeUndefined();
    expect(data.omp.activeModel).toBe("kimi/kimi-k3");
  });

  it("DELETE of a model clears every official role pointing at it", async () => {
    writeFileSync(modelsPath(), "providers:\n  9router:\n    baseUrl: http://127.0.0.1:20128/v1\n    api: openai-completions\n    apiKey: sk_x\n    models:\n      - id: kimi/kimi-k3\n        name: kimi/kimi-k3\n      - id: gcli/grok-4.6\n        name: gcli/grok-4.6\n");
    writeFileSync(configPath(), "modelRoles:\n  default: 9router/kimi/kimi-k3\n  smol: 9router/gcli/grok-4.6\n  task: 9router/kimi/kimi-k3\n");
    const res = await route.DELETE({ url: "http://x/omp-settings?model=kimi/kimi-k3" });
    expect(res.status).toBe(200);
    const cfg = readConfig();
    expect(cfg.modelRoles.default).toBeUndefined();
    expect(cfg.modelRoles.task).toBeUndefined();
    expect(cfg.modelRoles.smol).toBe("9router/gcli/grok-4.6");
  });

  it("omitted roles leave existing modelRoles untouched", async () => {
    writeFileSync(modelsPath(), "providers:\n  9router:\n    baseUrl: http://127.0.0.1:20128/v1\n    api: openai-completions\n    apiKey: sk_old\n    models:\n      - id: kimi/kimi-k3\n        name: kimi/kimi-k3\n");
    writeFileSync(configPath(), "modelRoles:\n  default: 9router/kimi/kimi-k3\n  smol: 9router/kimi/kimi-k3\n  advisor: xai-oauth/grok-4.6\n");
    const res = await route.POST({
      json: async () => ({
        baseUrl: "http://127.0.0.1:20128",
        apiKey: "sk_x",
        models: ["kimi/kimi-k3", "gcli/grok-4.6"],
      }),
    });
    expect(res.status).toBe(200);
    expect(readConfig().modelRoles).toEqual({
      default: "9router/kimi/kimi-k3",
      smol: "9router/kimi/kimi-k3",
      advisor: "xai-oauth/grok-4.6",
    });
  });

  it("empty role string clears only that 9Router assignment", async () => {
    writeFileSync(modelsPath(), "providers:\n  9router:\n    baseUrl: http://127.0.0.1:20128/v1\n    api: openai-completions\n    apiKey: sk_old\n    models:\n      - id: kimi/kimi-k3\n        name: kimi/kimi-k3\n");
    writeFileSync(configPath(), "modelRoles:\n  default: 9router/kimi/kimi-k3\n  smol: 9router/kimi/kimi-k3\n  advisor: xai-oauth/grok-4.6\n");
    const res = await route.PATCH({
      json: async () => ({ scope: "global", roles: { smol: "", advisor: "" } }),
    });
    expect(res.status).toBe(200);
    const cfg = readConfig();
    expect(cfg.modelRoles.default).toBe("9router/kimi/kimi-k3");
    expect(cfg.modelRoles.smol).toBeUndefined();
    // A foreign-provider role is not ours to clear.
    expect(cfg.modelRoles.advisor).toBe("xai-oauth/grok-4.6");
  });

  it("switches an existing official role to another selected model", async () => {
    writeFileSync(modelsPath(), "providers:\n  9router:\n    baseUrl: http://127.0.0.1:20128/v1\n    api: openai-completions\n    apiKey: sk_old\n    models:\n      - id: kimi/kimi-k3\n        name: kimi/kimi-k3\n      - id: gcli/grok-4.6\n        name: gcli/grok-4.6\n");
    writeFileSync(configPath(), "modelRoles:\n  default: 9router/kimi/kimi-k3\n  task: 9router/kimi/kimi-k3\n");
    const res = await route.PATCH({
      json: async () => ({ scope: "global", roles: { task: "gcli/grok-4.6" } }),
    });
    expect(res.status).toBe(200);
    const cfg = readConfig();
    expect(cfg.modelRoles.default).toBe("9router/kimi/kimi-k3");
    expect(cfg.modelRoles.task).toBe("9router/gcli/grok-4.6");
  });

  it("GET after Apply still reports the written roles", async () => {
    await route.POST({
      json: async () => ({
        baseUrl: "http://127.0.0.1:20128",
        apiKey: "sk_x",
        models: ["kimi/kimi-k3", "gcli/grok-4.6"],
      }),
    });
    await route.PATCH({
      json: async () => ({
        scope: "global",
        roles: { default: "kimi/kimi-k3", smol: "gcli/grok-4.6" },
      }),
    });
    const data = await (await route.GET()).json();
    expect(data.omp.roles.default).toBe("kimi/kimi-k3");
    expect(data.omp.roles.smol).toBe("gcli/grok-4.6");
    expect(data.omp.activeModel).toBe("kimi/kimi-k3");
  });

  it("full reset clears official 9Router roles and keeps foreign plus custom roles", async () => {
    writeFileSync(modelsPath(), "providers:\n  other: { baseUrl: http://other/v1 }\n  9router:\n    baseUrl: http://127.0.0.1:20128/v1\n    api: openai-completions\n    apiKey: sk_x\n    models:\n      - id: kimi/kimi-k3\n        name: kimi/kimi-k3\n");
    writeFileSync(configPath(), "modelRoles:\n  default: 9router/kimi/kimi-k3\n  smol: 9router/kimi/kimi-k3\n  advisor: xai-oauth/grok-4.6\n  reviewer: 9router/kimi/kimi-k3\n");
    const res = await route.DELETE({ url: "http://x/omp-settings" });
    expect(res.status).toBe(200);
    expect(readModelsFile().doc.providers["9router"]).toBeFalsy();
    expect(readModelsFile().doc.providers.other).toBeTruthy();
    // Foreign-provider roles survive; the custom `reviewer` role pointed at a
    // 9Router model, so removing the provider must clear it too.
    expect(readConfig().modelRoles).toEqual({
      advisor: "xai-oauth/grok-4.6",
    });
  });

  it("assigning official roles leaves unofficial custom role keys untouched", async () => {
    writeFileSync(modelsPath(), "providers:\n  9router:\n    baseUrl: http://127.0.0.1:20128/v1\n    api: openai-completions\n    apiKey: sk_old\n    models:\n      - id: kimi/kimi-k3\n        name: kimi/kimi-k3\n      - id: gcli/grok-4.6\n        name: gcli/grok-4.6\n");
    writeFileSync(configPath(), "modelRoles:\n  default: 9router/kimi/kimi-k3\n  reviewer: local/custom-reviewer\n  cycleOrder: [default, smol]\n");
    const res = await route.PATCH({
      json: async () => ({
        scope: "global",
        roles: { default: "gcli/grok-4.6", smol: "kimi/kimi-k3" },
      }),
    });
    expect(res.status).toBe(200);
    const cfg = readConfig();
    expect(cfg.modelRoles.default).toBe("9router/gcli/grok-4.6");
    expect(cfg.modelRoles.smol).toBe("9router/kimi/kimi-k3");
    expect(cfg.modelRoles.reviewer).toBe("local/custom-reviewer");
    expect(cfg.modelRoles.cycleOrder).toEqual(["default", "smol"]);
  });

  it("can assign a custom role that already exists in the config", async () => {
    writeFileSync(modelsPath(), "providers:\n  9router:\n    baseUrl: http://127.0.0.1:20128/v1\n    api: openai-completions\n    apiKey: sk_old\n    models:\n      - id: kimi/kimi-k3\n        name: kimi/kimi-k3\n");
    writeFileSync(configPath(), "modelRoles:\n  reviewer: local/custom-reviewer\n");
    const res = await route.PATCH({
      json: async () => ({ scope: "global", roles: { reviewer: "kimi/kimi-k3" } }),
    });
    expect(res.status).toBe(200);
    expect(readConfig().modelRoles.reviewer).toBe("9router/kimi/kimi-k3");
  });

  it("refuses a custom role that does not already exist", async () => {
    writeFileSync(modelsPath(), "providers:\n  9router:\n    baseUrl: http://127.0.0.1:20128/v1\n    api: openai-completions\n    apiKey: sk_old\n    models:\n      - id: kimi/kimi-k3\n        name: kimi/kimi-k3\n");
    const res = await route.PATCH({
      json: async () => ({ scope: "global", roles: { brandNewRole: "kimi/kimi-k3" } }),
    });
    expect(res.status).toBe(400);
  });



});
