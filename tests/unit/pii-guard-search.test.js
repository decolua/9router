import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ observeRequest: vi.fn(), searchCore: vi.fn() }));
vi.mock("@/lib/piiGuard/observe.js", () => ({ observeRequest: mocks.observeRequest, blockMessage: (names, chat = true) => `pii-guard blocked a new value: ${names.join(", ")}.${chat ? " /rewind" : ""}` }));
vi.mock("@/lib/localDb", () => ({ getSettings: async () => ({ requireApiKey: false, piiGuard: { mode: "redact" } }), getCombos: async () => [] }));
vi.mock("../../src/sse/services/auth.js", () => ({ getProviderCredentials: vi.fn(), markAccountUnavailable: vi.fn(), clearAccountError: vi.fn(), extractApiKey: () => null, isValidApiKey: vi.fn() }));
vi.mock("@/shared/constants/providers.js", () => ({ AI_PROVIDERS: { searxng: { noAuth: true, searchConfig: {} } }, resolveProviderId: id => id }));
vi.mock("open-sse/handlers/search/index.js", () => ({ handleSearchCore: mocks.searchCore }));
vi.mock("open-sse/utils/error.js", () => ({ errorResponse: (status, message) => Response.json({ error: message }, { status }), unavailableResponse: (status, message) => Response.json({ error: message }, { status }) }));
vi.mock("open-sse/services/combo.js", () => ({ handleComboChat: vi.fn(), getComboModelsFromData: () => null }));
vi.mock("../../src/sse/services/keyAccess.js", () => ({ getKeyAccessContext: async () => null, enforceKeyAccessProvider: async () => null }));
vi.mock("../../src/sse/services/tokenRefresh.js", () => ({ updateProviderCredentials: vi.fn(), checkAndRefreshToken: vi.fn() }));
vi.mock("../../src/sse/utils/logger.js", () => ({ request: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn(), maskKey: vi.fn() }));

import { handleSearch } from "../../src/sse/handlers/search.js";
const req = body => new Request("http://localhost/v1/search", { method: "POST", body: JSON.stringify(body) });

describe("PII guard search hook", () => {
  beforeEach(() => { vi.clearAllMocks(); process.env.PII_GUARD_MODULE = "/scanner.js"; mocks.searchCore.mockResolvedValue({ success: true, response: Response.json({}) }); });

  it("blocks before the provider call", async () => {
    mocks.observeRequest.mockResolvedValue({ blocked: ["email"] });
    const res = await handleSearch(req({ provider: "searxng", query: "mail a@b.co" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).not.toContain("/rewind");
    expect(mocks.searchCore).not.toHaveBeenCalled();
  });

  it("sends the redacted query upstream", async () => {
    mocks.observeRequest.mockImplementation(async body => { body.query = "mail {{pii:email#abc123}}"; });
    await handleSearch(req({ provider: "searxng", query: "mail a@b.co" }));
    expect(mocks.searchCore.mock.calls[0][0].body?.query ?? JSON.stringify(mocks.searchCore.mock.calls[0])).toContain("{{pii:email#abc123}}");
  });
});
