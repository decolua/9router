// Routes that fetch a request-supplied URL must, for remote callers, resolve DNS and
// re-validate redirects — a literal-host check alone is bypassed by a hostname pointed at
// 127.0.0.1 or a public URL that 30x's inward. Local callers keep self-hosted targets.
//   - /api/auth/oidc/test           (GHSA-8g4w): issuer + discovered token_endpoint
//   - /api/provider-nodes/validate  (#3293 / GHSA-vcxr)
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import dns from "node:dns";

const mocks = vi.hoisted(() => ({ isLocalRequest: vi.fn() }));

vi.mock("@/dashboardGuard", () => ({ isLocalRequest: mocks.isLocalRequest }));
vi.mock("@/lib/localDb", () => ({ getSettings: vi.fn(async () => ({ requireLogin: false })) }));
vi.mock("@/lib/auth/dashboardSession", () => ({ verifyDashboardAuthToken: vi.fn(async () => false) }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: () => undefined })) }));

const { POST: oidcTest } = await import("../../src/app/api/auth/oidc/test/route.js");
const { POST: validateNode } = await import("../../src/app/api/provider-nodes/validate/route.js");
const { GET: suggestedModels } = await import("../../src/app/api/providers/suggested-models/route.js");

const PUBLIC_IP = "93.184.216.34";
const originalFetch = global.fetch;
let fetchMock;

function jsonRes(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function post(url, body) {
  return new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

beforeEach(() => {
  mocks.isLocalRequest.mockReturnValue(false);
  fetchMock = vi.fn();
  global.fetch = fetchMock;
  vi.spyOn(dns.promises, "lookup").mockImplementation(async (host) => {
    if (host === "rebind.example.com") return [{ address: "127.0.0.1", family: 4 }];
    return [{ address: PUBLIC_IP, family: 4 }];
  });
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("OIDC test endpoint SSRF guard", () => {
  const url = "http://router.example.com/api/auth/oidc/test";

  it("rejects a loopback issuer from a remote caller without fetching", async () => {
    const res = await oidcTest(post(url, { issuerUrl: "http://127.0.0.1:80", clientId: "x" }));

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an issuer hostname that resolves to loopback", async () => {
    const res = await oidcTest(post(url, { issuerUrl: "https://rebind.example.com", clientId: "x" }));

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not POST the client secret to an internal token_endpoint named by discovery", async () => {
    fetchMock.mockResolvedValueOnce(jsonRes({ token_endpoint: "http://169.254.169.254/latest/meta-data" }));

    const res = await oidcTest(post(url, { issuerUrl: "https://idp.example.com", clientId: "x", clientSecret: "s3cret" }));

    expect(res.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("still allows a LAN/self-hosted issuer from the local host", async () => {
    mocks.isLocalRequest.mockReturnValue(true);
    fetchMock.mockResolvedValueOnce(jsonRes({ token_endpoint: "http://127.0.0.1:8080/token" }));

    const res = await oidcTest(post(url, { issuerUrl: "http://127.0.0.1:8080", clientId: "x" }));

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("provider-nodes validate SSRF guard", () => {
  const url = "http://router.example.com/api/provider-nodes/validate";

  it("rejects a baseUrl hostname that resolves to loopback", async () => {
    const res = await validateNode(post(url, { baseUrl: "https://rebind.example.com/v1", apiKey: "k" }));

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not follow a redirect from a public baseUrl to an internal host", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 302, headers: { location: "http://127.0.0.1:11434/v1/models" } }));

    const res = await validateNode(post(url, { baseUrl: "https://api.example.com/v1", apiKey: "k" }));
    const body = await res.json();

    expect(body.valid).toBe(false);
    expect(fetchMock).toHaveBeenCalled();
    for (const [target, init] of fetchMock.mock.calls) {
      expect(new URL(String(target)).hostname).toBe("api.example.com");
      // Native fetch would follow the 302 itself; redirects must be surfaced for re-validation.
      expect(init?.redirect).toBe("manual");
    }
  });

  it("suggested-models refuses an internal catalog URL from a remote caller (#1207)", async () => {
    const target = encodeURIComponent("http://169.254.169.254/latest/meta-data");
    const res = await suggestedModels(new Request(`http://router.example.com/api/providers/suggested-models?type=opencode-free&url=${target}`));

    expect((await res.json()).data).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("suggested-models still fetches a public catalog", async () => {
    fetchMock.mockResolvedValue(jsonRes({ data: [{ id: "big-pickle" }] }));
    const target = encodeURIComponent("https://opencode.ai/zen/v1/models");
    const res = await suggestedModels(new Request(`http://router.example.com/api/providers/suggested-models?type=opencode-free&url=${target}`));

    expect((await res.json()).data).toEqual([{ id: "big-pickle", name: "big-pickle" }]);
  });

  it("still validates a local node from the local host", async () => {
    mocks.isLocalRequest.mockReturnValue(true);
    fetchMock.mockResolvedValue(jsonRes({ data: [] }));

    const res = await validateNode(post(url, { baseUrl: "http://localhost:11434/v1", apiKey: "k" }));
    const body = await res.json();

    expect(body.valid).toBe(true);
  });
});
