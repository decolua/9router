import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// DATA_DIR is resolved at import time, so it must point at a scratch dir before
// the service is loaded — never the real ~/.9router or the deployed volume.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "codex-catalog-test-"));
process.env.DATA_DIR = TMP;

const fetchMock = vi.fn();
const refreshMock = vi.fn();

vi.mock("open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => fetchMock(...args),
}));
vi.mock("open-sse/services/tokenRefresh.js", () => ({
  refreshCodexToken: (...args) => refreshMock(...args),
}));

let catalog;
let snapshotFile;

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

const entry = (slug, plans = ["plus"], extra = {}) => ({
  slug,
  display_name: slug,
  description: "",
  visibility: "list",
  supported_in_api: true,
  priority: 0,
  context_window: 272000,
  available_in_plans: plans,
  ...extra,
});

const conn = (id) => ({
  id,
  provider: "codex",
  isActive: true,
  accessToken: `access-${id}`,
  refreshToken: `refresh-${id}`,
  providerSpecificData: { chatgptAccountId: `account-${id}` },
});

const writeSnapshot = (models) => {
  fs.writeFileSync(snapshotFile, JSON.stringify({ version: 1, fetchedAt: "2026-01-01T00:00:00.000Z", models }), "utf8");
  catalog.clearCodexCatalogCache();
};

const removeSnapshot = () => {
  fs.rmSync(snapshotFile, { force: true });
  catalog.clearCodexCatalogCache();
};

beforeAll(async () => {
  catalog = await import("open-sse/services/codexCatalog.js");
  snapshotFile = catalog.CODEX_CATALOG_FILE;
  expect(snapshotFile.startsWith(TMP)).toBe(true);
});

beforeEach(() => {
  fetchMock.mockReset();
  refreshMock.mockReset();
  removeSnapshot();
});

afterAll(() => {
  // Windows holds the dir open handles briefly; a failed cleanup must not fail
  // the suite (the assertions above are the contract).
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
});

describe("mergeCodexCatalogs", () => {
  it("unions slugs across plans and keeps upstream picker order", () => {
    const merged = catalog.mergeCodexCatalogs([
      [entry("gpt-6-astra"), entry("gpt-5.6-sol")],
      [entry("gpt-5.6-sol"), entry("gpt-5.6-terra")],
    ]);
    expect(merged.map((m) => m.slug)).toEqual(["gpt-6-astra", "gpt-5.6-sol", "gpt-5.6-terra"]);
  });

  it("prefers the entry with broader plan coverage for the same slug", () => {
    const free = entry("gpt-6-astra", ["free"], { context_window: 128000 });
    const team = entry("gpt-6-astra", ["free", "plus", "team", "enterprise"], { context_window: 272000 });
    expect(catalog.mergeCodexCatalogs([[free], [team]])[0]).toEqual(team);
    expect(catalog.mergeCodexCatalogs([[team], [free]])[0]).toEqual(team);
  });

  it("passes entries through verbatim and skips malformed ones", () => {
    const rich = entry("gpt-6-astra", ["plus"], { tool_mode: "code_mode_only", use_responses_lite: true });
    const merged = catalog.mergeCodexCatalogs([[rich, { display_name: "no slug" }, null, { slug: "" }]]);
    expect(merged).toEqual([rich]);
  });

  it("returns an empty list for no input", () => {
    expect(catalog.mergeCodexCatalogs([])).toEqual([]);
    expect(catalog.mergeCodexCatalogs([null, undefined])).toEqual([]);
  });
});

describe("resolveCodexCatalog — live fetch", () => {
  it("fetches the Codex catalog with the CLI identity headers and persists it", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ models: [entry("gpt-6-astra"), entry("gpt-6.1-sol")] }));

    const result = await catalog.resolveCodexCatalog({ connections: [conn("a")] });

    expect(result.source).toBe("live");
    expect(result.models.map((m) => m.slug)).toEqual(["gpt-6-astra", "gpt-6.1-sol"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toMatch(/^https:\/\/chatgpt\.com\/backend-api\/codex\/models\?client_version=\d+\.\d+\.\d+$/);
    expect(options.headers.Authorization).toBe("Bearer access-a");
    expect(options.headers["chatgpt-account-id"]).toBe("account-a");
    expect(options.headers.originator).toBe("codex_cli_rs");
    expect(options.headers.version).toMatch(/^\d+\.\d+\.\d+$/);

    const persisted = JSON.parse(fs.readFileSync(snapshotFile, "utf8"));
    expect(persisted.models.map((m) => m.slug)).toEqual(["gpt-6-astra", "gpt-6.1-sol"]);
    expect(persisted.fetchedAt).toBe(result.fetchedAt);
  });

  it("merges every active connection so one plan cannot hide another's models", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ models: [entry("gpt-5.6-sol", ["free"])] }))
      .mockResolvedValueOnce(jsonResponse({ models: [entry("gpt-6-astra", ["team"]), entry("gpt-5.6-sol", ["free", "team"])] }));

    const result = await catalog.resolveCodexCatalog({ connections: [conn("free"), conn("team")] });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.models.map((m) => m.slug)).toEqual(["gpt-5.6-sol", "gpt-6-astra"]);
    expect(result.models[0].available_in_plans).toEqual(["free", "team"]);
  });

  it("keeps snapshot models the router still advertises when the live catalog is narrower", async () => {
    // The regression this endpoint exists for: the only reachable account is on
    // a plan whose catalog omits 6.x, and the picker silently downgrades.
    writeSnapshot([entry("gpt-6-astra", ["team"]), entry("gpt-5.5", ["plus"])]);
    fetchMock.mockResolvedValue(jsonResponse({ models: [entry("gpt-5.6-sol", ["free"])] }));

    const result = await catalog.resolveCodexCatalog({ connections: [conn("a")] });

    expect(result.source).toBe("live");
    expect(result.models.map((m) => m.slug)).toEqual(["gpt-5.6-sol", "gpt-6-astra"]);
    // gpt-5.5 was dropped from the router's own registry (upstream returns 400),
    // so a stale snapshot entry for it must not be resurrected.
    expect(JSON.parse(fs.readFileSync(snapshotFile, "utf8")).models.map((m) => m.slug))
      .toEqual(["gpt-5.6-sol", "gpt-6-astra"]);
  });

  it("lets a successful upstream fetch remove a model the router no longer lists", async () => {
    writeSnapshot([entry("gpt-5.5"), entry("gpt-5.4")]);
    fetchMock.mockResolvedValue(jsonResponse({ models: [entry("gpt-6-astra")] }));

    const result = await catalog.resolveCodexCatalog({ connections: [conn("a")] });
    expect(result.models.map((m) => m.slug)).toEqual(["gpt-6-astra"]);
  });

  it("refreshes only after a 401 and persists the rotated tokens", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: "expired" }, 401))
      .mockResolvedValueOnce(jsonResponse({ models: [entry("gpt-6-astra")] }));
    refreshMock.mockResolvedValue({ accessToken: "new-access", refreshToken: "new-refresh", expiresIn: 3600 });
    const onCredentialsRefreshed = vi.fn().mockResolvedValue(undefined);

    const result = await catalog.resolveCodexCatalog({ connections: [conn("a")], onCredentialsRefreshed });

    expect(result.source).toBe("live");
    expect(refreshMock).toHaveBeenCalledWith("refresh-a", undefined);
    expect(onCredentialsRefreshed).toHaveBeenCalledTimes(1);
    expect(onCredentialsRefreshed.mock.calls[0][1]).toMatchObject({ accessToken: "new-access", refreshToken: "new-refresh" });
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe("Bearer new-access");
  });

  it("does not refresh proactively on a successful fetch", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ models: [entry("gpt-6-astra")] }));
    await catalog.resolveCodexCatalog({ connections: [conn("a")] });
    // Codex rotates the refresh token on every use; an eager refresh here can
    // revoke the whole OpenAI session.
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("falls back to the snapshot when the refresh token is unrecoverable", async () => {
    writeSnapshot([entry("gpt-6-astra", ["team"])]);
    fetchMock.mockResolvedValue(jsonResponse({ error: "invalid_grant" }, 401));
    refreshMock.mockResolvedValue({ error: "unrecoverable_refresh_error", code: "invalid_grant" });

    const result = await catalog.resolveCodexCatalog({ connections: [conn("a")] });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.source).toBe("snapshot");
    expect(result.models.map((m) => m.slug)).toEqual(["gpt-6-astra"]);
  });

  it("caches within the TTL and refetches on forceRefresh", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ models: [entry("gpt-6-astra")] }));
    await catalog.resolveCodexCatalog({ connections: [conn("a")] });
    await catalog.resolveCodexCatalog({ connections: [conn("a")] });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await catalog.resolveCodexCatalog({ connections: [conn("a")], forceRefresh: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("resolveCodexCatalog — degradation", () => {
  it("serves the persisted snapshot untouched when every fetch fails", async () => {
    writeSnapshot([entry("gpt-6-astra", ["team"]), entry("gpt-6.1-sol", ["team"])]);
    const before = fs.readFileSync(snapshotFile, "utf8");
    fetchMock.mockResolvedValue(jsonResponse({ error: "upstream down" }, 503));

    const result = await catalog.resolveCodexCatalog({ connections: [conn("a")] });

    expect(result.source).toBe("snapshot");
    expect(result.models.map((m) => m.slug)).toEqual(["gpt-6-astra", "gpt-6.1-sol"]);
    expect(result.fetchedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(result.warning).toContain("503");
    expect(fs.readFileSync(snapshotFile, "utf8")).toBe(before);
  });

  it("survives a transport error without clearing the snapshot", async () => {
    writeSnapshot([entry("gpt-6-astra")]);
    fetchMock.mockRejectedValue(new Error("ECONNRESET"));

    const result = await catalog.resolveCodexCatalog({ connections: [conn("a")] });
    expect(result.source).toBe("snapshot");
    expect(result.models).toHaveLength(1);
    expect(result.warning).toContain("ECONNRESET");
  });

  it("reports unavailable rather than inventing metadata when nothing is known", async () => {
    const result = await catalog.resolveCodexCatalog({ connections: [] });
    expect(result.source).toBe("unavailable");
    expect(result.models).toEqual([]);
    expect(fs.existsSync(snapshotFile)).toBe(false);
  });

  it("ignores connections without an access token", async () => {
    const result = await catalog.resolveCodexCatalog({
      connections: [{ ...conn("a"), accessToken: null }],
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.source).toBe("unavailable");
  });

  it("rejects an upstream body that is not a models array", async () => {
    writeSnapshot([entry("gpt-6-astra")]);
    fetchMock.mockResolvedValue(jsonResponse({ object: "list", data: [] }));

    const result = await catalog.resolveCodexCatalog({ connections: [conn("a")] });
    expect(result.source).toBe("snapshot");
    expect(result.warning).toContain("no models array");
  });

  it("still returns live models when the snapshot cannot be written", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ models: [entry("gpt-6-astra")] }));
    // A directory at the snapshot path makes the rename fail.
    fs.mkdirSync(snapshotFile, { recursive: true });
    catalog.clearCodexCatalogCache();

    const result = await catalog.resolveCodexCatalog({ connections: [conn("a")] });
    expect(result.source).toBe("live");
    expect(result.models.map((m) => m.slug)).toEqual(["gpt-6-astra"]);
    expect(result.warning).toContain("snapshot not written");
    fs.rmSync(snapshotFile, { recursive: true, force: true });
  });
});