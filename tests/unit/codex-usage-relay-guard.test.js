import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock proxyAwareFetch so we can control the relay response
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

const { getUsageForProvider } = await import("../../open-sse/services/usage.js");
const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");

function makeResponse({ ok = true, status = 200, contentType = "application/json", body = "{}" }) {
  return {
    ok,
    status,
    headers: {
      get: (name) => (name.toLowerCase() === "content-type" ? contentType : null),
    },
    json: async () => JSON.parse(body),
    text: async () => body,
  };
}

describe("Codex usage relay guard (non-JSON / HTML relay)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a safe message when relay returns HTML (404 page)", async () => {
    proxyAwareFetch.mockResolvedValueOnce(
      makeResponse({
        contentType: "text/html; charset=utf-8",
        body: "<!DOCTYPE html><html><body>404 Not Found</body></html>",
      })
    );

    const conn = { provider: "codex", accessToken: "tok-123" };
    const result = await getUsageForProvider(conn, null);

    expect(result).toEqual({
      message: "Codex usage relay returned non-JSON response (possible relay outage).",
    });
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
  });

  it("returns a safe message when content-type claims JSON but body is invalid", async () => {
    proxyAwareFetch.mockResolvedValueOnce(
      makeResponse({
        contentType: "application/json",
        body: "<!DOCTYPE html>not json",
      })
    );

    const conn = { provider: "codex", accessToken: "tok-456" };
    const result = await getUsageForProvider(conn, null);

    expect(result).toEqual({
      message: "Codex usage response was not valid JSON (possible relay outage).",
    });
  });

  it("still succeeds when relay returns valid JSON", async () => {
    proxyAwareFetch.mockResolvedValueOnce(
      makeResponse({
        contentType: "application/json",
        body: JSON.stringify({
          plan_type: "pro",
          rate_limit: { used: 12, total: 100 },
        }),
      })
    );

    const conn = { provider: "codex", accessToken: "tok-789" };
    const result = await getUsageForProvider(conn, null);

    expect(result.plan).toBe("pro");
    expect(result.quotas).toBeDefined();
  });
});
