import { describe, expect, it, vi } from "vitest";

// v1/models/route.js pulls in a LOT of deps (live resolvers, localDb, etc.).
// We only test the requireApiKey guard, so mock the heavy imports.
vi.mock("@/lib/localDb", () => ({
  getSettings: vi.fn(),
  getProviderConnections: vi.fn(() => []),
  getCombos: vi.fn(() => []),
  getCustomModels: vi.fn(() => []),
  getModelAliases: vi.fn(() => null),
}));
vi.mock("@/sse/services/auth", () => ({
  extractApiKey: vi.fn(),
  isValidApiKey: vi.fn(),
}));

// The route imports a LOT of open-sse services; alias those to no-ops.
vi.mock("open-sse/providers/capabilities.js", () => ({
  capabilitiesFromServiceKind: vi.fn(() => []),
  getCapabilitiesForModel: vi.fn(() => ({})),
}));
vi.mock("open-sse/services/kiroModels.js", () => ({ resolveKiroModels: vi.fn(() => null) }));
vi.mock("open-sse/services/kimchiModels.js", () => ({ resolveKimchiModels: vi.fn(() => null) }));
vi.mock("open-sse/services/qoderModels.js", () => ({ resolveQoderModels: vi.fn(() => null) }));
vi.mock("open-sse/services/copilotModels.js", () => ({ resolveCopilotModels: vi.fn(() => null) }));
vi.mock("open-sse/services/clinepassModels.js", () => ({ resolveClinepassModels: vi.fn(() => null) }));
vi.mock("open-sse/services/grokCliModels.js", () => ({ resolveGrokCliModels: vi.fn(() => null) }));
vi.mock("open-sse/services/cursorModels.js", () => ({ resolveCursorModels: vi.fn(() => null) }));
vi.mock("open-sse/shared/zedAuth.js", () => ({ resolveZedModels: vi.fn(() => null) }));
vi.mock("@/shared/constants/models", () => ({ PROVIDER_MODELS: {}, PROVIDER_ID_TO_ALIAS: {}, getModelKind: vi.fn(() => "chat") }));
vi.mock("@/shared/constants/providers", () => ({
  AI_PROVIDERS: [],
  getProviderAlias: vi.fn((p) => p),
  isAnthropicCompatibleProvider: vi.fn(() => false),
  isOpenAICompatibleProvider: vi.fn(() => true),
}));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: vi.fn(() => []) }));
vi.mock("@/sse/services/tokenRefresh", () => ({ updateProviderCredentials: vi.fn() }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(() => ({})) }));

import { getSettings, getProviderConnections, getCombos, getCustomModels, getModelAliases } from "@/lib/localDb";
import { extractApiKey, isValidApiKey } from "@/sse/services/auth";
import { GET } from "../../src/app/api/v1/models/route.js";

function req(authHeader) {
  const headers = new Headers();
  if (authHeader) headers.set("Authorization", authHeader);
  headers.set("x-internal-models-fetch", "1"); // skip dynamic fetch (avoid real provider calls)
  return { headers };
}

describe("GET /v1/models requireApiKey guard (#2834)", () => {
  it("returns 401 when requireApiKey is on and no key present", async () => {
    getSettings.mockResolvedValue({ requireApiKey: true });
    extractApiKey.mockReturnValue(null);
    const res = await GET(req(null));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.message).toContain("Missing API key");
  });

  it("returns 401 when requireApiKey is on and key is invalid", async () => {
    getSettings.mockResolvedValue({ requireApiKey: true });
    extractApiKey.mockReturnValue("bad-key");
    isValidApiKey.mockResolvedValue(false);
    const res = await GET(req("Bearer bad-key"));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.message).toContain("Invalid API key");
  });

  it("serves models when requireApiKey is off (no auth needed)", async () => {
    getSettings.mockResolvedValue({ requireApiKey: false });
    const res = await GET(req(null));
    expect(res.status).toBe(200);
  });

  it("serves models when requireApiKey is on and key is valid", async () => {
    getSettings.mockResolvedValue({ requireApiKey: true });
    extractApiKey.mockReturnValue("good-key");
    isValidApiKey.mockResolvedValue(true);
    const res = await GET(req("Bearer good-key"));
    expect(res.status).toBe(200);
  });
});
