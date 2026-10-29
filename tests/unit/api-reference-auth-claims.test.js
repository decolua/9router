// DF-9ROUTER-9 / DF-9ROUTER-14 / DF-9ROUTER-19:
// The published API documentation described an auth model the running server
// does not implement. Three independent dogfood runs hit the same wall:
//
//   * `docs/api-reference.md` opened the Authentication section with "Every `/v1`
//     request needs an API key" and then showed `POST /api/keys` as a bare
//     unauthenticated curl. Runtime answers 401 — `/api/keys` sits in
//     PROTECTED_API_PATHS (src/dashboardGuard.js) and needs the dashboard JWT
//     (`POST /api/auth/login`) or the host CLI token (`x-9r-cli-token`).
//   * `/v1` is a PUBLIC prefix gated by canAccessPublicLlmApi: loopback clients
//     are trusted with no key, and a remote client without a key is allowed
//     while the effective `requireApiKey` is false — which is exactly what the
//     shipped `.env.example` sets (`REQUIRE_API_KEY=false`).
//   * The README `REQUIRE_API_KEY` row listed the default as `false` without the
//     unset semantics: an unset var falls back to the STORED setting, whose
//     default is `true` (settingsRepo DEFAULT_SETTINGS + the exact-value-only
//     env override).
//
// This suite asserts documentation↔code agreement, not prose. Every code-side
// fact is read from the source that implements it (`src/dashboardGuard.js`,
// `src/lib/db/repos/settingsRepo.js`, `.env.example`) — never a hardcoded copy —
// and the imported guard is exercised directly, so a rename or a re-classified
// route fails the suite instead of silently passing. It is deterministic and
// offline: no server boot, no network.
import { describe, expect, it, vi, beforeEach } from "vitest";
import fs from "fs";

// The guard imports Next.js internals and DB helpers; the same seams
// tests/unit/dashboard-guard.test.js stubs are stubbed here.
const mocks = vi.hoisted(() => ({
  nextResponse: Symbol("next"),
  jsonResponse: vi.fn((body, init) => ({ status: init?.status || 200, body })),
  getSettings: vi.fn(),
  validateApiKey: vi.fn(),
  getConsistentMachineId: vi.fn(),
  verifyDashboardAuthToken: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    next: vi.fn(() => mocks.nextResponse),
    json: mocks.jsonResponse,
    redirect: vi.fn((url) => ({ status: 307, url })),
  },
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  validateApiKey: mocks.validateApiKey,
}));

vi.mock("@/shared/utils/machineId", () => ({
  getConsistentMachineId: mocks.getConsistentMachineId,
}));

vi.mock("@/lib/auth/dashboardSession", () => ({
  verifyDashboardAuthToken: mocks.verifyDashboardAuthToken,
}));

const { proxy, __test__ } = await import("../../src/dashboardGuard.js");

const PEER_TOKEN = "peer-token-fixture";

// ---------------------------------------------------------------- doc reading

const API_DOC = fs.readFileSync(new URL("../../docs/api-reference.md", import.meta.url), "utf8");
const README = fs.readFileSync(new URL("../../README.md", import.meta.url), "utf8");
const ENV_EXAMPLE = fs.readFileSync(new URL("../../.env.example", import.meta.url), "utf8");
const GUARD_SRC = fs.readFileSync(new URL("../../src/dashboardGuard.js", import.meta.url), "utf8");
const SETTINGS_SRC = fs.readFileSync(
  new URL("../../src/lib/db/repos/settingsRepo.js", import.meta.url),
  "utf8"
);

// The `## Authentication` section, up to the next top-level heading.
function section(doc, heading) {
  const parts = doc.split(/^## /m);
  const hit = parts.find((p) => p.startsWith(heading));
  if (!hit) throw new Error(`section "${heading}" not found`);
  return hit;
}

// Fenced code blocks of one language inside a section.
function fencedBlocks(text, lang) {
  return [...text.matchAll(new RegExp("```" + lang + "\\n([\\s\\S]*?)```", "g"))].map((m) => m[1]);
}

const AUTH_SECTION = section(API_DOC, "Authentication");

// --------------------------------------------------- code-side ground truth

// Read an exported module-level array literal out of the guard source instead of
// duplicating it: a route re-classified in src/ must move this suite.
function stringArray(source, name) {
  const m = source.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`));
  if (!m) throw new Error(`const ${name} not found in dashboardGuard.js`);
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

const PUBLIC_API_PATHS = stringArray(GUARD_SRC, "PUBLIC_API_PATHS");
const PUBLIC_PREFIXES = stringArray(GUARD_SRC, "PUBLIC_PREFIXES");
const PROTECTED_API_PATHS = stringArray(GUARD_SRC, "PROTECTED_API_PATHS");
const ALWAYS_PROTECTED = stringArray(GUARD_SRC, "ALWAYS_PROTECTED");
const LOCAL_ONLY_PATHS = stringArray(GUARD_SRC, "LOCAL_ONLY_PATHS");
const CLI_TOKEN_HEADER = GUARD_SRC.match(/const CLI_TOKEN_HEADER = "([^"]+)"/)?.[1];

const GET_SETTINGS_DEFAULT_REQUIRE_API_KEY = /requireApiKey:\s*(true|false)/.exec(SETTINGS_SRC)?.[1];

// Active (uncommented) assignment in .env.example, as @next/env would read it.
function envExampleValue(key) {
  const line = ENV_EXAMPLE.split("\n").find((l) => !/^\s*[#;]/.test(l) && new RegExp(`^\\s*${key}\\s*=`).test(l));
  return line ? line.slice(line.indexOf("=") + 1).trim().split(/\s+/)[0] : null;
}

const README_REQUIRE_API_KEY_ROW = README.split("\n").find((l) => /^\|\s*`REQUIRE_API_KEY`/.test(l)) || "";

function request(pathname, headers = {}) {
  return {
    nextUrl: { pathname, searchParams: new URL(`http://localhost${pathname}`).searchParams },
    headers: new Headers(headers),
    cookies: { get: vi.fn(() => undefined) },
    url: `http://localhost${pathname}`,
  };
}

// A request that really came from off-host: the custom server stamps the proxy
// hop, so the loopback socket is not the end user.
function remoteRequest(pathname, headers = {}) {
  return request(pathname, { host: "router.example.com", "x-9r-via-proxy": "1", ...headers });
}

// A request that really reached the server from the same host: custom-server.js
// stamps the TCP peer address and proves it with the per-process secret, which is
// exactly what isLoopbackPeer() trusts outside development.
function localRequest(pathname, headers = {}) {
  return request(pathname, {
    host: "localhost:20128",
    "x-9r-peer-token": PEER_TOKEN,
    "x-9r-real-ip": "127.0.0.1",
    ...headers,
  });
}

describe("api-reference auth claims match dashboardGuard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NINEROUTER_PEER_TOKEN = PEER_TOKEN;
    mocks.getSettings.mockResolvedValue({ requireLogin: true });
    mocks.validateApiKey.mockResolvedValue(false);
    mocks.getConsistentMachineId.mockResolvedValue("cli-token");
    mocks.verifyDashboardAuthToken.mockResolvedValue(false);
  });

  it("reads real path classes out of the guard (guard against a stale copy)", () => {
    // If these ever come back empty the rest of the suite would pass vacuously.
    expect(PUBLIC_API_PATHS.length).toBeGreaterThan(5);
    expect(PROTECTED_API_PATHS.length).toBeGreaterThan(5);
    expect(PUBLIC_PREFIXES).toEqual(["/v1", "/v1beta", "/api/v1", "/api/v1beta", "/codex", "/responses"]);
    expect(CLI_TOKEN_HEADER).toBe("x-9r-cli-token");
    expect(GET_SETTINGS_DEFAULT_REQUIRE_API_KEY).toBe("true");
  });

  it("carries no unqualified 'every /v1 request needs an API key' claim in English docs", () => {
    const docsDir = new URL("../../docs/", import.meta.url);
    const files = fs
      .readdirSync(docsDir, { recursive: true })
      .filter((f) => String(f).endsWith(".md"))
      .map((f) => ({ path: `docs/${f}`, text: fs.readFileSync(new URL(String(f), docsDir), "utf8") }));
    files.push({ path: "README.md", text: README });

    // Two shapes are offenders:
    //   (a) the exact blanket phrasing the three dogfood runs quoted;
    //   (b) any "requires an API key" line that does NOT qualify the requirement
    //       (no remote/while/when/only/if/except in the same sentence).
    const qualified = /remote|while|when|only|if |except|loopback|keyless/i;
    const offenders = [];
    for (const { path, text } of files) {
      text.split("\n").forEach((line, i) => {
        const blanket = /needs an API key|every\s+.\/v1.\s+request\s+(needs|requires)/i.test(line);
        const unqualified = /require(s)? an? (valid )?api key/i.test(line) && !qualified.test(line);
        if (blanket || unqualified) offenders.push(`${path}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders, "the blanket claim must be gone (or explicitly qualified)").toEqual([]);
  });

  it("ships the POST /api/keys example with the login step before the create call", () => {
    const block = fencedBlocks(AUTH_SECTION, "bash").find((b) => b.includes("/api/keys"));
    expect(block, "the Authentication section must show the /api/keys example").toBeTruthy();

    const loginAt = block.indexOf("/api/auth/login");
    const createAt = block.indexOf("/api/keys");
    expect(loginAt, "the login step must be present in the example").toBeGreaterThan(-1);
    expect(loginAt, "the login step must precede the create call").toBeLessThan(createAt);
    expect(block, "the login step must write a cookie jar").toMatch(/-c\s+\S*cookies\.txt/);
    expect(block, "the create call must reuse the cookie jar").toMatch(/-b\s+\S*cookies\.txt/);
  });

  it("states the 401 you get without a session, next to the example", () => {
    expect(AUTH_SECTION).toMatch(/401 \{"error":"Unauthorized"\}/);
    expect(AUTH_SECTION, "the 401 must be tied to the missing session").toMatch(/without (a )?session|Skip step 1/i);
  });

  it("names the real /api/* public allow-list and the deny-by-default default", () => {
    // Every allow-listed path in the guard must be named in the doc section.
    const missing = PUBLIC_API_PATHS.filter((p) => !AUTH_SECTION.includes(p));
    expect(missing, "public /api/* paths the doc never mentions").toEqual([]);

    // And the doc must say what happens to everything else.
    expect(AUTH_SECTION).toMatch(/deny-by-default/i);
    for (const route of ["/api/keys", ...ALWAYS_PROTECTED.slice(0, 2)]) {
      expect(AUTH_SECTION, `${route} must be documented`).toContain(route);
    }
    expect(AUTH_SECTION, "the CLI token header must be documented").toContain(CLI_TOKEN_HEADER);
    expect(AUTH_SECTION, "the dashboard session cookie must be documented").toMatch(/auth_token/);
  });

  it("names the guard's stricter route classes (always-protected 401 / local-only 403)", () => {
    // Every stricter route in the guard must be documented — literally, or (for
    // a family the doc describes by its directory, e.g. the /api/tunnel/ helpers)
    // by that directory prefix.
    const documented = (entry) =>
      AUTH_SECTION.includes(entry) ||
      AUTH_SECTION.includes(entry.slice(0, entry.lastIndexOf("/") + 1));
    const missing = [...ALWAYS_PROTECTED, ...LOCAL_ONLY_PATHS].filter((p) => !documented(p));
    expect(missing, "stricter routes the doc never mentions").toEqual([]);

    // ...and the two distinct answers must be stated.
    expect(AUTH_SECTION).toMatch(/requireLogin: false/);
    expect(AUTH_SECTION).toMatch(/`403`/);
  });

  it("keeps the doc's /api/* claim true against the live guard", async () => {
    // Deny-by-default: a remote, unauthenticated caller cannot reach /api/keys.
    const denied = await proxy(remoteRequest("/api/keys"));
    expect(denied.status).toBe(401);
    expect(denied.body.error).toBe("Unauthorized");

    // Each /api/keys entry in the guard really is a protected class.
    expect(PROTECTED_API_PATHS).toContain("/api/keys");
    expect(PUBLIC_API_PATHS).not.toContain("/api/keys");
    expect(LOCAL_ONLY_PATHS.length).toBeGreaterThan(0);

    // Public allow-list bypasses the session.
    const allowed = await proxy(remoteRequest("/api/health"));
    expect(allowed).toBe(mocks.nextResponse);
  });

  it("names every public LLM prefix and keeps the prefix list honest", () => {
    for (const prefix of PUBLIC_PREFIXES) {
      expect(AUTH_SECTION, `${prefix} must be documented as an LLM prefix`).toContain(prefix);
      expect(__test__.isPublicLlmApi(prefix), `${prefix} must be a public LLM prefix`).toBe(true);
      expect(__test__.isPublicLlmApi(`${prefix}/models`)).toBe(true);
    }
    // ...and the dashboard surface is NOT one of them.
    expect(__test__.isPublicLlmApi("/api/keys")).toBe(false);
  });

  it("documents the key forms the guard actually extracts", () => {
    const forms = [
      { header: { authorization: "Bearer sk-from-bearer" }, docForm: "Authorization: Bearer", expected: "sk-from-bearer" },
      { header: { "x-api-key": "sk-from-x-api-key" }, docForm: "x-api-key", expected: "sk-from-x-api-key" },
      { header: { "x-goog-api-key": "sk-from-goog" }, docForm: "x-goog-api-key", expected: "sk-from-goog" },
    ];
    const docLower = AUTH_SECTION.toLowerCase();
    for (const { header, docForm, expected } of forms) {
      expect(__test__.extractApiKey(request("/v1/models", header))).toBe(expected);
      expect(docLower, `the ${docForm} form must be documented`).toContain(docForm.toLowerCase());
    }
    // The query-parameter form.
    expect(__test__.extractApiKey(request("/v1/models?key=sk-from-query"))).toBe("sk-from-query");
    expect(AUTH_SECTION, "the ?key= form must be documented").toMatch(/key=sk-/);
  });

  it("states the loopback-trusted and requireApiKey-false rules the guard implements", async () => {
    // Loopback is trusted with no key at all — regardless of the setting.
    const keylessLocal = await proxy(localRequest("/v1/models"));
    expect(keylessLocal).toBe(mocks.nextResponse);
    expect(mocks.validateApiKey).not.toHaveBeenCalled();

    // Remote + keyless: the effective setting decides.
    mocks.getSettings.mockResolvedValue({ requireLogin: true, requireApiKey: false });
    const maskedOff = await proxy(remoteRequest("/v1/models"));
    expect(maskedOff).toBe(mocks.nextResponse);

    mocks.getSettings.mockResolvedValue({ requireLogin: true, requireApiKey: true });
    const enforced = await proxy(remoteRequest("/v1/models"));
    expect(enforced.status).toBe(401);
    // DF-9ROUTER-56: OpenAI envelope, not the old bare-string error.
    expect(enforced.body.error).toEqual({
      message: "API key required for remote API access",
      type: "authentication_error",
      code: "invalid_api_key",
    });

    // ...and the doc says exactly that.
    expect(AUTH_SECTION).toMatch(/loopback/i);
    expect(AUTH_SECTION).toMatch(/requireApiKey/);
    expect(AUTH_SECTION).toMatch(/reverse proxy/i);
    expect(AUTH_SECTION).toMatch(/API key required for remote API access/);
    expect(AUTH_SECTION).toMatch(/authentication_error/);
  });

  it("documents the endpoint-handler layer the handlers implement", () => {
    // The doc claims the LLM handlers re-check the setting themselves (so a
    // keyless LOOPBACK completion still 401s while requireApiKey is true, even
    // though the guard let it through). That claim must be code-backed.
    const chatSrc = fs.readFileSync(new URL("../../src/sse/handlers/chat.js", import.meta.url), "utf8");
    expect(chatSrc, "chat.js must gate on the effective setting").toMatch(/if \(settings\.requireApiKey\)/);
    expect(chatSrc).toMatch(/"Missing API key"/);
    expect(chatSrc).toMatch(/"Invalid API key"/);

    expect(AUTH_SECTION).toMatch(/endpoint handler/i);
    expect(AUTH_SECTION).toMatch(/Missing API key/);
    expect(AUTH_SECTION).toMatch(/Invalid API key/);
    // The live-verified matrix rows must name both probed endpoints.
    expect(AUTH_SECTION).toContain("`GET /v1/models`");
    expect(AUTH_SECTION).toContain("`POST /v1/chat/completions`");
  });
});

describe("README REQUIRE_API_KEY row matches the runtime semantics", () => {
  it("has a row at all", () => {
    expect(README_REQUIRE_API_KEY_ROW).not.toBe("");
  });

  it("covers true / false / unset, the .env.example value, and the deploy advice", () => {
    const row = README_REQUIRE_API_KEY_ROW;
    expect(row).toMatch(/`true`/);
    expect(row).toMatch(/`false`/);
    // Unset falls back to the stored setting, which defaults to true.
    expect(row, "unset semantics must be stated").toMatch(/unset/i);
    expect(row).toMatch(/default is `true`/i);
    expect(row, ".env.example's shipped value must be stated").toMatch(/\.env\.example/);
    expect(row, "internet-exposed deploys must be advised").toMatch(/internet-exposed deploys/i);
  });

  it("agrees with settingsRepo and .env.example (unset => stored default true)", () => {
    // Stored default is true …
    const defaultBlock = SETTINGS_SRC.slice(SETTINGS_SRC.indexOf("DEFAULT_SETTINGS"));
    expect(defaultBlock).toMatch(/requireApiKey:\s*true/);

    // … the env override only honors exact "true"/"false", so anything else
    // (including unset/typos/empty) leaves the stored value in place.
    const override = SETTINGS_SRC.slice(SETTINGS_SRC.indexOf("function envRequireApiKeyOverride"));
    expect(override).toMatch(/raw === "true"/);
    expect(override).toMatch(/raw === "false"/);
    expect(override).toMatch(/return undefined/);

    // … and the file every quickstart copies pins it to false.
    expect(envExampleValue("REQUIRE_API_KEY")).toBe("false");

    // The doc must not claim otherwise: the doc's `false` claim is about
    // .env.example, so both facts have to be present in the row.
    expect(README_REQUIRE_API_KEY_ROW).toMatch(/`false`/);
    expect(README_REQUIRE_API_KEY_ROW).toMatch(/stored setting/i);
  });
});
