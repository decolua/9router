import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnectionById: vi.fn(),
  refreshClaudeOAuthToken: vi.fn(),
  updateProviderCredentials: vi.fn(),
}));

vi.mock("@/models", () => ({ getProviderConnectionById: mocks.getProviderConnectionById }));
vi.mock("@/sse/services/tokenRefresh", () => ({
  refreshClaudeOAuthToken: mocks.refreshClaudeOAuthToken,
  refreshGoogleToken: vi.fn(),
  refreshCodexToken: vi.fn(),
  updateProviderCredentials: mocks.updateProviderCredentials,
}));

const originalFetch = global.fetch;

describe("Claude live models", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProviderConnectionById.mockResolvedValue({
      id: "claude-1",
      provider: "claude",
      authType: "oauth",
      accessToken: "oauth-token",
      refreshToken: "refresh-token",
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("uses OAuth headers and collects every models page", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{ id: "claude-opus-5", display_name: "Claude Opus 5" }],
        has_more: true,
        last_id: "claude-opus-5",
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{ id: "claude-sonnet-5", display_name: "Claude Sonnet 5" }],
        has_more: false,
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    global.fetch = fetchMock;

    const { GET } = await import("@/app/api/providers/[id]/models/route.js");
    const response = await GET(new Request("http://localhost/api/providers/claude-1/models"), {
      params: Promise.resolve({ id: "claude-1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.models.map((model) => model.id)).toEqual(["claude-opus-5", "claude-sonnet-5"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({
      Authorization: "Bearer oauth-token",
      "Anthropic-Version": "2023-06-01",
      "Anthropic-Beta": "oauth-2025-04-20",
    });
    expect(String(fetchMock.mock.calls[1][0])).toContain("after_id=claude-opus-5");
  });
});
