import { describe, it, expect, vi, beforeEach } from "vitest";
import { discoverAuth } from "@/lib/mcp/gateway/oauthDiscovery";

// Mock global fetch to return controlled discovery docs without network.
// discoverAuth builds candidate URLs from instanceUrl using META_PATHS, so
// mock keys MUST match those constructed URLs.
function mockFetch(urlToResponse) {
  return vi.fn(async (url) => {
    const key = typeof url === "string" ? url : url.toString();
    const res = urlToResponse[key];
    if (!res) return { ok: false, json: async () => null };
    return { ok: true, json: async () => res };
  });
}

const UPSTREAM = "https://upstream.example";
const PR_URL = `${UPSTREAM}/.well-known/oauth-protected-resource`;
const AS_BASE = "https://as.example";
const AS_WK = `${AS_BASE}/.well-known/oauth-authorization-server`;

describe("discoverAuth registration_endpoint fallback", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = originalFetch;
  });

  it("preserves registration_endpoint from protected-resource doc when AS well-known omits it", async () => {
    global.fetch = mockFetch({
      [PR_URL]: {
        resource: UPSTREAM,
        authorization_servers: [AS_BASE],
        registration_endpoint: "https://as.example/register",
      },
      [AS_WK]: {
        authorization_endpoint: "https://as.example/authorize",
        token_endpoint: "https://as.example/token",
        // AS well-known doc LACKS registration_endpoint
      },
    });

    const result = await discoverAuth(UPSTREAM, {});
    expect(result).not.toBeNull();
    expect(result.registration_endpoint).toBe("https://as.example/register");
    expect(result.authorization_endpoint).toBe("https://as.example/authorize");
  });

  it("prefers AS well-known registration_endpoint over protected-resource doc", async () => {
    global.fetch = mockFetch({
      [PR_URL]: {
        resource: UPSTREAM,
        authorization_servers: [AS_BASE],
        registration_endpoint: "https://pr.example/register",
      },
      [AS_WK]: {
        authorization_endpoint: "https://as.example/authorize",
        token_endpoint: "https://as.example/token",
        registration_endpoint: "https://as.example/register",
      },
    });

    const result = await discoverAuth(UPSTREAM, {});
    expect(result).not.toBeNull();
    expect(result.registration_endpoint).toBe("https://as.example/register");
  });

  it("returns null when no discovery docs are found", async () => {
    global.fetch = mockFetch({});
    const result = await discoverAuth(UPSTREAM, {});
    expect(result).toBeNull();
  });
});
