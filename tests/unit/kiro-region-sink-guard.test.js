// GHSA-6mwv: route-level region checks don't cover values that reach the DB another way
// (PUT /api/providers/[id] merges providerSpecificData, import-cli-proxy stored it raw).
// Every URL sink that interpolates a stored region must refuse to leave *.amazonaws.com.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { KiroExecutor } from "../../open-sse/executors/kiro.js";
import { safeAwsRegion } from "../../open-sse/config/awsRegion.js";
import { normalizeKiroExternalIdpAuth } from "../../src/lib/oauth/kiroExternalIdp.js";

const EVIL_REGIONS = ["evil.example#", "attacker.test/x?", "us-east-1.evil.example#", "", "US-EAST-1"];

function hostOf(url) {
  return new URL(url).hostname;
}

describe("Kiro region sink guard", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("safeAwsRegion only passes real AWS region ids", () => {
    expect(safeAwsRegion("eu-west-1")).toBe("eu-west-1");
    expect(safeAwsRegion(" ap-southeast-2 ")).toBe("ap-southeast-2");
    for (const bad of EVIL_REGIONS) expect(safeAwsRegion(bad)).toBe("us-east-1");
  });

  it.each(EVIL_REGIONS)("executor keeps every Amazon surface on amazonaws.com (region %j)", (region) => {
    const urls = new KiroExecutor().getOrderedBaseUrls({ providerSpecificData: { authMethod: "idc", region } });

    for (const url of urls.filter((u) => u.includes("amazonaws"))) {
      expect(hostOf(url).endsWith(".amazonaws.com"), url).toBe(true);
    }
  });

  it("still regionalizes a valid IDC region", () => {
    const urls = new KiroExecutor().getOrderedBaseUrls({ providerSpecificData: { authMethod: "idc", region: "eu-west-1" } });

    expect(urls.some((u) => hostOf(u) === "q.eu-west-1.amazonaws.com")).toBe(true);
  });

  it("IDC token refresh never posts the client secret off AWS", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ accessToken: "a", refreshToken: "r", expiresIn: 3600 }),
    });
    global.fetch = fetchMock;

    const { refreshKiroToken } = await import("../../open-sse/services/tokenRefresh.js");
    await refreshKiroToken("refresh-token-region-guard", {
      authMethod: "idc",
      clientId: "cid",
      clientSecret: "csecret",
      region: "evil.example#",
    });

    expect(fetchMock).toHaveBeenCalled();
    expect(hostOf(String(fetchMock.mock.calls[0][0]))).toBe("oidc.us-east-1.amazonaws.com");
  }, 30_000); // cold import of the tokenRefresh graph after resetModules

  it("rejects a CLIProxyAPI import whose region is not an AWS region", () => {
    const jwt = `h.${Buffer.from(JSON.stringify({ email: "u@example.com" })).toString("base64url")}.s`;
    const auth = {
      auth_method: "external_idp",
      access_token: jwt,
      refresh_token: "rt",
      client_id: "00000000-0000-4000-8000-000000000000",
      token_endpoint: "https://login.microsoftonline.com/t/oauth2/v2.0/token",
      profile_arn: "arn:aws:codewhisperer:us-east-1:123456789012:profile/ABC",
      scopes: "api://x/codewhisperer:conversations offline_access",
    };

    expect(() => normalizeKiroExternalIdpAuth({ ...auth, region: "evil.example#" })).toThrow(/region/);
    expect(normalizeKiroExternalIdpAuth({ ...auth, region: "eu-central-1" }).providerSpecificData.region).toBe("eu-central-1");
  });
});
