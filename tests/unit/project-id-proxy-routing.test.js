import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalFetch = globalThis.fetch;
const proxyRoute = {
  source: "pool",
  proxyPoolId: "project-pool",
  connectionProxyEnabled: true,
  connectionProxyUrl: "http://proxy.test:8080",
  connectionNoProxy: "",
  strictProxy: true,
  disableEnvProxy: true,
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("project ID proxy routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("uses the selected route for load and onboarding requests", async () => {
    globalThis.fetch
      .mockResolvedValueOnce(jsonResponse({ allowedTiers: [{ id: "standard-tier", isDefault: true }] }))
      .mockResolvedValueOnce(jsonResponse({
        done: true,
        response: { cloudaicompanionProject: { id: "project-routed" } },
      }));
    const { getProjectIdForConnection, removeConnection } = await import("../../open-sse/services/projectId.js");

    const result = await getProjectIdForConnection("project-route-unique", "access-token", proxyRoute);

    expect(result).toBe("project-routed");
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(globalThis.fetch.mock.calls.every((call) => call[1].proxyOptions === proxyRoute)).toBe(true);
    removeConnection("project-route-unique");
  });

  it("does not log provider bodies or credential-bearing URLs", async () => {
    const secret = "https://user:password@provider.test/token?code=SECRET-CODE&access_token=SECRET-TOKEN";
    globalThis.fetch.mockResolvedValueOnce(new Response(secret, { status: 500 }));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { getProjectIdForConnection, removeConnection } = await import("../../open-sse/services/projectId.js");

    await getProjectIdForConnection("project-error-unique", "access-token", proxyRoute);

    const output = warning.mock.calls.flat().map(String).join(" ");
    for (const value of ["user", "password", "SECRET-CODE", "SECRET-TOKEN"]) {
      expect(output).not.toContain(value);
    }
    removeConnection("project-error-unique");
  });
});
