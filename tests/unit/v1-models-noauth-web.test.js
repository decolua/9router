import { describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getCombos: vi.fn(async () => []),
  getCustomModels: vi.fn(async () => []),
  getModelAliases: vi.fn(async () => ({})),
}));

vi.mock("@/lib/localDb", () => db);
vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels: vi.fn(async () => ({})),
}));
vi.mock("@/sse/services/keyAccess.js", () => ({
  getKeyAccessContext: vi.fn(),
  filterModelsListForKey: vi.fn(),
}));
vi.mock("@/sse/services/tokenRefresh", () => ({
  updateProviderCredentials: vi.fn(),
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn(),
}));
vi.mock("open-sse/services/kiroModels.js", () => ({ resolveKiroModels: vi.fn() }));
vi.mock("open-sse/services/kimchiModels.js", () => ({ resolveKimchiModels: vi.fn() }));
vi.mock("open-sse/services/qoderModels.js", () => ({
  resolveQoderModels: vi.fn(),
  routableQoderModels: vi.fn(),
}));
vi.mock("open-sse/services/copilotModels.js", () => ({ resolveCopilotModels: vi.fn() }));
vi.mock("open-sse/services/clinepassModels.js", () => ({
  resolveClinepassModels: vi.fn(),
  resolveClineModels: vi.fn(),
}));
vi.mock("open-sse/services/grokCliModels.js", () => ({ resolveGrokCliModels: vi.fn() }));
vi.mock("open-sse/services/cursorModels.js", () => ({ resolveCursorModels: vi.fn() }));
vi.mock("open-sse/shared/zedAuth.js", () => ({ resolveZedModels: vi.fn() }));
vi.mock("open-sse/services/commandcodeModels.js", () => ({ resolveCommandCodeModels: vi.fn() }));

const { buildModelsList } = await import("../../src/app/api/v1/models/route.js");

const WEB_KINDS = ["webSearch", "webFetch"];

describe("no-auth web providers on /v1/models/web", () => {
  it("lists Keenable when there are no connections", async () => {
    db.getProviderConnections.mockResolvedValue([]);
    const ids = (await buildModelsList(WEB_KINDS)).map((model) => model.id);
    expect(ids).toContain("keenable/search");
    expect(ids).toContain("keenable/fetch");
  });

  it("lists Keenable when only an unrelated connection is active", async () => {
    db.getProviderConnections.mockResolvedValue([
      { id: 1, provider: "openai", isActive: true },
    ]);
    const ids = (await buildModelsList(WEB_KINDS)).map((model) => model.id);
    expect(ids).toContain("keenable/search");
    expect(ids).toContain("keenable/fetch");
  });
});
