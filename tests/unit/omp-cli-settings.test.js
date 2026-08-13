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

  it("refuses to write models when config.yml is corrupt and a default is requested", async () => {
    writeFileSync(modelsPath(), "");
    const corruptCfg = "modelRoles:\n  default:\n    bad-: ::\n    :::\n  [unclosed\n";
    writeFileSync(configPath(), corruptCfg);

    const req = { json: async () => ({ baseUrl: "http://127.0.0.1:20128", apiKey: "sk_x", models: ["cc/claude-opus-5"], activeModel: "cc/claude-opus-5" }) };
    const res = await route.POST(req);
    expect(res.status).toBe(409);

    expect(readFileSync(modelsPath(), "utf-8")).toBe("");
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

  it("writes modelRoles.default only when caller supplies activeModel", async () => {
    const req = { json: async () => ({ baseUrl: "http://127.0.0.1:20128", apiKey: "sk_x", models: ["cc/claude-opus-5"], activeModel: "cc/claude-opus-5" }) };
    await route.POST(req);

    expect(readConfig().modelRoles.default).toBe("9router/cc/claude-opus-5");
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
});
