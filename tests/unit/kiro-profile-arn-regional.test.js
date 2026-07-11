import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchKiroProfileArn } from "../../src/lib/oauth/providerHelpers.js";

/**
 * Regression tests for regional Kiro profileArn discovery.
 *
 * Bug context: fetchKiroProfileArn hard-coded
 *   https://codewhisperer.us-east-1.amazonaws.com/ListAvailableProfiles
 * with `Content-Type: application/json`. That breaks two things at once:
 *
 *   1. IDC accounts issued in eu-west-1 / ap-southeast-1 / etc. still get
 *      pinned to a us-east-1 endpoint, silently 403-ing every subsequent
 *      generateAssistantResponse / GetUsageLimits call.
 *   2. AWS CodeWhisperer expects x-amz-target dispatch with
 *      `application/x-amz-json-1.0`. Servers that reject unknown paths return
 *      401 to the wrong URL shape, masking the real error.
 *
 * These tests pin the fix:
 *   - endpoint is codewhisperer.<region>.amazonaws.com
 *   - method is POST to the service root with x-amz-target dispatch
 *   - Content-Type is application/x-amz-json-1.0
 *   - profile whose ARN region matches the caller region wins over the first
 *     profile in the list
 *   - unknown/invalid region falls back to us-east-1 (never crashes)
 */
describe("fetchKiroProfileArn — regional endpoint + dispatch shape", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("hits codewhisperer.<region>.amazonaws.com with x-amz-target dispatch", async () => {
    const expectedArn = "arn:aws:codewhisperer:eu-west-1:123456789012:profile/EU";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ profiles: [{ arn: expectedArn }] }),
    });

    const arn = await fetchKiroProfileArn("token", "eu-west-1");
    expect(arn).toBe(expectedArn);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://codewhisperer.eu-west-1.amazonaws.com");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/x-amz-json-1.0");
    expect(init.headers["x-amz-target"]).toBe(
      "AmazonCodeWhispererService.ListAvailableProfiles"
    );
    expect(init.headers.Authorization).toBe("Bearer token");
  });

  it("prefers the profile whose ARN region matches the caller region", async () => {
    const usArn = "arn:aws:codewhisperer:us-east-1:111:profile/US";
    const apArn = "arn:aws:codewhisperer:ap-southeast-1:222:profile/AP";
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      // us-east-1 comes back first but we asked for ap-southeast-1 — that
      // must win, otherwise IDC users get 403 on their regional endpoint.
      json: async () => ({ profiles: [{ arn: usArn }, { arn: apArn }] }),
    });

    const arn = await fetchKiroProfileArn("token", "ap-southeast-1");
    expect(arn).toBe(apArn);
  });

  it("falls back to the first profile when no ARN matches the region", async () => {
    const usArn = "arn:aws:codewhisperer:us-east-1:111:profile/US";
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ profiles: [{ arn: usArn }] }),
    });

    const arn = await fetchKiroProfileArn("token", "eu-west-1");
    expect(arn).toBe(usArn);
  });

  it("accepts both `arn` and `profileArn` field names in the response", async () => {
    const expectedArn = "arn:aws:codewhisperer:us-east-1:111:profile/ALT";
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ profiles: [{ profileArn: expectedArn }] }),
    });

    const arn = await fetchKiroProfileArn("token", "us-east-1");
    expect(arn).toBe(expectedArn);
  });

  it("defaults to us-east-1 when region is missing or malformed", async () => {
    const expectedArn = "arn:aws:codewhisperer:us-east-1:111:profile/X";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ profiles: [{ arn: expectedArn }] }),
    });

    await fetchKiroProfileArn("token"); // no region
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://codewhisperer.us-east-1.amazonaws.com"
    );

    await fetchKiroProfileArn("token", "not-a-region");
    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://codewhisperer.us-east-1.amazonaws.com"
    );

    await fetchKiroProfileArn("token", null);
    expect(fetchMock.mock.calls[2][0]).toBe(
      "https://codewhisperer.us-east-1.amazonaws.com"
    );
  });

  it("returns null on non-2xx responses without throwing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => "Forbidden",
    });
    const arn = await fetchKiroProfileArn("token", "eu-west-1");
    expect(arn).toBeNull();
  });

  it("returns null on network failure without throwing", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("boom"));
    const arn = await fetchKiroProfileArn("token", "eu-west-1");
    expect(arn).toBeNull();
  });

  it("returns null when access token is missing", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    expect(await fetchKiroProfileArn(null, "eu-west-1")).toBeNull();
    expect(await fetchKiroProfileArn("", "eu-west-1")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
