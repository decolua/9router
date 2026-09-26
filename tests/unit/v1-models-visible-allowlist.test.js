// /v1/models must honour the provider-level "visible models" allowlist even for
// providers served from a live catalog. GitHub Copilot is the case that matters:
// its registry list lags upstream, so a blacklist built from the dashboard's
// model chips can never name catalog-only ids (gpt-4o, copilot-search-a, ...).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;

// Live catalog: gpt-5.4 is in the static registry, the other two are not.
const LIVE_MODELS = [
  { id: "gpt-5.4", name: "GPT-5.4" },
  { id: "gpt-4o", name: "GPT-4o" },
  { id: "copilot-search-a", name: "Copilot Search A" },
];

vi.mock("open-sse/services/copilotModels.js", () => ({
  resolveCopilotModels: vi.fn(async () => ({ models: LIVE_MODELS })),
  clearCopilotModelCache: vi.fn(),
}));

let db;
let buildModelsList;

const ghIds = (models) => models.filter((m) => m.id.startsWith("gh/")).map((m) => m.id);

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-visible-models-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
  await db.createProviderConnection({
    provider: "github",
    authType: "oauth",
    name: "test-account",
    email: "test@example.com",
    isActive: true,
    accessToken: "fake-access-token",
    providerSpecificData: { copilotToken: "fake-copilot-token" },
  });
  ({ buildModelsList } = await import("@/app/api/v1/models/route.js"));
});

afterAll(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

beforeEach(async () => {
  await db.setEnabledModels("gh", []);
});

describe("/v1/models visible-model allowlist", () => {
  it("exposes the whole live catalog when no allowlist is set", async () => {
    const models = await buildModelsList(["llm"], {});
    expect(ghIds(models)).toEqual(
      expect.arrayContaining(["gh/gpt-5.4", "gh/gpt-4o", "gh/copilot-search-a"])
    );
  });

  it("exposes only allowlisted ids once the allowlist is set", async () => {
    await db.setEnabledModels("gh", ["gpt-4o"]);
    const models = await buildModelsList(["llm"], {});
    expect(ghIds(models)).toEqual(["gh/gpt-4o"]);
  });

  it("ignores blank and duplicate allowlist entries", async () => {
    await db.setEnabledModels("gh", ["  gpt-4o  ", "", "   ", "gpt-4o"]);
    expect(await db.getEnabledByProvider("gh")).toEqual(["gpt-4o"]);
    const models = await buildModelsList(["llm"], {});
    expect(ghIds(models)).toEqual(["gh/gpt-4o"]);
  });

  it("keeps merging custom models, which the allowlist does not hide", async () => {
    await db.setEnabledModels("gh", ["gpt-4o"]);
    await db.addCustomModel({ providerAlias: "gh", id: "gpt-5.6-sol", type: "llm", name: "gpt-5.6-sol" });
    const models = await buildModelsList(["llm"], {});
    expect(ghIds(models).sort()).toEqual(["gh/gpt-4o", "gh/gpt-5.6-sol"]);
    await db.deleteCustomModel({ providerAlias: "gh", id: "gpt-5.6-sol", type: "llm" });
  });

  it("restores the full catalog when the allowlist is cleared", async () => {
    await db.setEnabledModels("gh", ["gpt-4o"]);
    expect(ghIds(await buildModelsList(["llm"], {}))).toEqual(["gh/gpt-4o"]);

    await db.setEnabledModels("gh", []);
    const ids = ghIds(await buildModelsList(["llm"], {}));
    expect(ids).toContain("gh/gpt-4o");
    expect(ids).toContain("gh/copilot-search-a");
  });

  it("still honours a hand-set providerSpecificData.enabledModels", async () => {
    const [connection] = await db.getProviderConnections();
    await db.updateProviderConnection(connection.id, {
      providerSpecificData: { ...connection.providerSpecificData, enabledModels: ["copilot-search-a"] },
    });
    const ids = ghIds(await buildModelsList(["llm"], {}));
    expect(ids).toEqual(["gh/copilot-search-a"]);
  });

  it("prefers the provider-level allowlist over a stale per-connection one", async () => {
    const [connection] = await db.getProviderConnections();
    await db.updateProviderConnection(connection.id, {
      providerSpecificData: { ...connection.providerSpecificData, enabledModels: ["copilot-search-a"] },
    });
    await db.setEnabledModels("gh", ["gpt-4o"]);
    const ids = ghIds(await buildModelsList(["llm"], {}));
    expect(ids).toEqual(["gh/gpt-4o"]);
  });
});

describe("PUT /api/models/enabled", () => {
  it("stores the allowlist and drops its ids from the disabled blacklist", async () => {
    await db.disableModels("gh", ["gpt-5.4", "gpt-4o"]);
    const { PUT } = await import("@/app/api/models/enabled/route.js");

    const response = await PUT(new Request("http://localhost/api/models/enabled", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerAlias: "gh", ids: ["gpt-5.4"] }),
    }));
    expect(response.status).toBe(200);

    // /v1/models applies the blacklist after the allowlist, so a whitelisted id
    // that stays blacklisted would silently remain hidden.
    expect(await db.getDisabledByProvider("gh")).toEqual(["gpt-4o"]);
    expect(ghIds(await buildModelsList(["llm"], {}))).toEqual(["gh/gpt-5.4"]);
  });
});
