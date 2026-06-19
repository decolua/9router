// Unit test for A4 #1908: /v1/models returns Codex shape when originator=codex_cli_rs.
import { describe, it, expect, vi, beforeEach } from "vitest";

// Stub the heavy dependencies so the route handler can run without a DB.
vi.mock("@/shared/constants/models", () => ({
  PROVIDER_MODELS: {},
  PROVIDER_ID_TO_ALIAS: {},
  getModelKind: () => "llm",
  LLM_KIND: "llm",
}));
vi.mock("@/shared/constants/providers", () => ({
  AI_PROVIDERS: {},
  getProviderAlias: () => "",
  isAnthropicCompatibleProvider: () => false,
  isOpenAICompatibleProvider: () => false,
}));
vi.mock("@/lib/localDb", () => ({
  getProviderConnections: () => [],
  getCombos: () => [],
  getCustomModels: () => [],
  getModelAliases: () => ({}),
}));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: () => [] }));
vi.mock("@/sse/services/tokenRefresh", () => ({ updateProviderCredentials: vi.fn() }));
vi.mock("open-sse/services/kiroModels.js", () => ({ resolveKiroModels: () => null }));
vi.mock("open-sse/services/qoderModels.js", () => ({ resolveQoderModels: () => null }));
vi.mock("open-sse/providers/capabilities.js", () => ({
  capabilitiesFromServiceKind: () => null,
  getCapabilitiesForModel: () => ({ search: true }),
}));

// Import after mocks are registered.
const { GET } = await import("../../src/app/api/v1/models/route.js");

function makeReq(headers = {}) {
  return { headers: { get: (k) => headers[k] || null } };
}

describe("GET /v1/models — codex shape detection (#1908)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns {object, data} for generic OpenAI clients", async () => {
    const res = await GET(makeReq({}));
    const body = await res.json();
    expect(body.object).toBe("list");
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.models).toBeUndefined();
  });

  it("returns {models} array for codex_cli_rs originator", async () => {
    const res = await GET(makeReq({ originator: "codex_cli_rs" }));
    const body = await res.json();
    expect(Array.isArray(body.models)).toBe(true);
    expect(body.object).toBeUndefined();
    if (body.models.length > 0) {
      const m = body.models[0];
      expect(m).toHaveProperty("slug");
      expect(m).toHaveProperty("display_name");
      expect(m).toHaveProperty("supported_in_api", true);
      expect(m).toHaveProperty("tool_mode", "auto");
      expect(m).toHaveProperty("multi_agent_version", null);
      expect(m).toHaveProperty("supports_search_tool");
    }
  });

  it("returns {models} array for user-agent containing 'codex'", async () => {
    const res = await GET(makeReq({ "user-agent": "codex-cli/1.0" }));
    const body = await res.json();
    expect(Array.isArray(body.models)).toBe(true);
  });
});
