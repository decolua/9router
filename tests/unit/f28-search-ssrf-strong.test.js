import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// F28 — the *network* path of /v1/search must use the strong SSRF guard
// (fetchPublic = literal checks + DNS resolution + per-hop redirect
// revalidation), the same one connectionCatalog uses. A layer-1-only
// `assertPublicUrl` at request-build time lets `attacker.nip.io` → 127.0.0.1
// and a 30x from a public host to an internal one through.

const { lookupMock } = vi.hoisted(() => ({ lookupMock: vi.fn() }));
vi.mock("node:dns", () => ({
  default: { promises: { lookup: lookupMock } },
  promises: { lookup: lookupMock },
}));

const { handleSearchCore } = await import("../../open-sse/handlers/search/index.js");

// Keyless BYO provider: the override survives the credential allowlist check and
// actually reaches the network layer, which is what these cases exercise.
const SEARXNG = {
  id: "searxng",
  baseUrl: "http://localhost:8888/search",
  method: "GET",
  authType: "none",
  searchTypes: ["web", "news"],
  defaultMaxResults: 5,
  maxMaxResults: 50,
};

function captureFetch(handler) {
  const calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url, init) => {
      calls.push({ url: String(url), redirect: init?.redirect });
      return (
        (handler && (await handler(String(url), init))) ||
        new Response(JSON.stringify({ results: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );
    })
  );
  return calls;
}

const urlOf = (call) => (typeof call === "string" ? call : call.url);

function searchAt(baseUrl) {
  return handleSearchCore({
    body: { query: "q", provider_options: { baseUrl } },
    provider: { id: "searxng" },
    providerConfig: SEARXNG,
    credentials: null,
  });
}

beforeEach(() => {
  lookupMock.mockReset();
  lookupMock.mockResolvedValue([{ address: "203.0.113.10", family: 4 }]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("F28: strong SSRF guard on the search network path", () => {
  it("rejects literal internal targets before any socket is opened", async () => {
    const calls = captureFetch();

    for (const baseUrl of [
      "http://169.254.169.254/latest/meta-data",
      "http://localhost:8080",
      "http://localhost./search",
      "http://[::1]:8888",
      "http://[::ffff:169.254.169.254]",
      "http://10.0.0.1",
      "http://192.168.1.5:8888",
      "http://searxng.internal",
      "file:///etc/passwd",
    ]) {
      const result = await searchAt(baseUrl);
      expect(result.success, `should reject ${baseUrl}`).toBe(false);
      expect(result.status).toBe(400);
    }

    expect(calls).toHaveLength(0);
  });

  it("rejects a public hostname that resolves to loopback (DNS rebinding / nip.io)", async () => {
    const calls = captureFetch();
    lookupMock.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);

    const result = await searchAt("http://127.0.0.1.nip.io:8888");

    expect(result.success).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("is the DNS layer doing the work — literal layer-1 checks alone would pass", async () => {
    const { assertPublicUrl } = await import("../../src/shared/utils/ssrfGuard.js");
    lookupMock.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);

    // Non-vacuity proof: `assertPublicUrl` (the guard the vulnerable path used to
    // stop at) cannot see this, so a build-time-only check would ship the hole.
    expect(() => assertPublicUrl("https://rebind.attacker.example")).not.toThrow();

    const calls = captureFetch();
    const result = await searchAt("https://rebind.attacker.example");
    expect(result.success).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("rejects a hostname whose second A record is internal", async () => {
    const calls = captureFetch();
    lookupMock.mockResolvedValue([
      { address: "203.0.113.10", family: 4 },
      { address: "169.254.169.254", family: 4 },
    ]);

    const result = await searchAt("https://multi-a.attacker.example");

    expect(result.success).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("rejects a hostname resolving to an internal IPv6 address", async () => {
    const calls = captureFetch();
    lookupMock.mockResolvedValue([{ address: "fd12:3456::1", family: 6 }]);

    const result = await searchAt("https://v6.attacker.example");

    expect(result.success).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("does not follow a redirect from a public host into loopback", async () => {
    const calls = captureFetch(() =>
      new Response(null, { status: 302, headers: { location: "http://127.0.0.1:8888/admin" } })
    );

    const result = await searchAt("https://redirector.attacker.example");

    expect(result.success).toBe(false);
    // Exactly one outbound hop: the redirect target was refused, never fetched.
    expect(calls).toHaveLength(1);
    expect(urlOf(calls[0]).startsWith("https://redirector.attacker.example")).toBe(true);
    expect(calls.map(urlOf).join(" ")).not.toContain("127.0.0.1");
    // redirects are walked by the guard (manual), never auto-followed by fetch
    expect(calls[0].redirect).toBe("manual");
  });

  it("does not follow a redirect chain that finally lands internal", async () => {
    const calls = captureFetch((url) => {
      if (url.includes("hop2")) {
        return new Response(null, { status: 301, headers: { location: "http://169.254.169.254/" } });
      }
      return new Response(null, { status: 302, headers: { location: "https://hop2.attacker.example/x" } });
    });

    const result = await searchAt("https://hop1.attacker.example");

    expect(result.success).toBe(false);
    expect(calls.map(urlOf).filter((u) => u.includes("169.254"))).toHaveLength(0);
    expect(calls.length).toBeLessThanOrEqual(2);
  });

  it("follows public-to-public redirects within the bound", async () => {
    const calls = captureFetch((url) => {
      if (url.includes("cdn.attacker.example")) {
        return new Response(JSON.stringify({ results: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(null, { status: 302, headers: { location: "https://cdn.attacker.example/search" } });
    });

    const result = await searchAt("https://entry.attacker.example");

    expect(result.success).toBe(true);
    expect(calls.length).toBe(2);
  });
});
