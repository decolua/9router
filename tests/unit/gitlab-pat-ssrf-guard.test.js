// Regression coverage for the SSRF gap in POST /api/oauth/gitlab/pat: `baseUrl`
// comes straight from the client, so a remote caller must not be able to point
// the server's user-info probe at an internal/loopback/metadata host. Local
// callers keep self-hosted GitLab on a private network reachable.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  isLocalRequest: vi.fn(),
  createProviderConnection: vi.fn(),
}));

vi.mock("@/dashboardGuard", () => ({ isLocalRequest: mocks.isLocalRequest }));
vi.mock("@/models", () => ({ createProviderConnection: mocks.createProviderConnection }));

const { POST } = await import("@/app/api/oauth/gitlab/pat/route.js");

const request = (body) => ({ json: async () => body });

describe("POST /api/oauth/gitlab/pat: SSRF guard on client-supplied baseUrl", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createProviderConnection.mockResolvedValue({ id: 1 });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("rejects a loopback baseUrl for a remote caller without ever fetching", async () => {
    mocks.isLocalRequest.mockReturnValue(false);
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy;

    const res = await POST(request({ token: "glpat-x", baseUrl: "http://127.0.0.1:9999" }));

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("URL not allowed");
  });

  it("still follows a public baseUrl for a remote caller", async () => {
    mocks.isLocalRequest.mockReturnValue(false);
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify({ username: "u", name: "n" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    global.fetch = fetchSpy;

    const res = await POST(request({ token: "glpat-x", baseUrl: "http://8.8.8.8" }));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toBe("http://8.8.8.8/api/v4/user");
    expect(res.status).toBe(200);
  });

  it("keeps a self-hosted GitLab on a private address reachable for local callers", async () => {
    mocks.isLocalRequest.mockReturnValue(true);
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ username: "u" }), { status: 200 }));
    global.fetch = fetchSpy;

    const res = await POST(request({ token: "glpat-x", baseUrl: "http://127.0.0.1:9999" }));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
  });
});