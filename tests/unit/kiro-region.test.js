import { describe, it, expect, vi, afterEach } from "vitest";
import {
  resolveKiroRegion,
  resolveKiroDataPlaneUrl,
  resolveKiroControlPlaneHost,
  KIRO_DEFAULT_REGION,
} from "../../open-sse/config/kiroConstants.js";
import { KiroExecutor } from "../../open-sse/executors/kiro.js";
import { fetchKiroProfileArn } from "../../src/lib/oauth/providerHelpers.js";

/**
 * Regression tests for multi-region Kiro / CodeWhisperer support.
 *
 * Background: Kiro assumed us-east-1 for the data plane, profile resolution and
 * usage. IAM Identity Center accounts homed elsewhere (e.g. eu-central-1) are
 * rejected with 403 "bearer token invalid" by the us-east-1 hosts, and their
 * CodeWhisperer profile is only visible from the regional Amazon Q endpoint.
 * The region (stored in providerSpecificData.region by the IdC device flow) now
 * drives those endpoints, defaulting to us-east-1 for existing accounts.
 */
describe("kiro region helpers", () => {
  it("defaults to us-east-1 and trims input", () => {
    expect(resolveKiroRegion()).toBe(KIRO_DEFAULT_REGION);
    expect(resolveKiroRegion("")).toBe("us-east-1");
    expect(resolveKiroRegion("  eu-central-1  ")).toBe("eu-central-1");
  });

  it("returns null data-plane URL for us-east-1 (keep registry baseUrls)", () => {
    expect(resolveKiroDataPlaneUrl()).toBeNull();
    expect(resolveKiroDataPlaneUrl("us-east-1")).toBeNull();
  });

  it("returns the regional Amazon Q data-plane URL for other regions", () => {
    expect(resolveKiroDataPlaneUrl("eu-central-1")).toBe(
      "https://q.eu-central-1.amazonaws.com/generateAssistantResponse"
    );
  });

  it("resolves the control-plane host per region", () => {
    expect(resolveKiroControlPlaneHost("us-east-1")).toBe(
      "https://codewhisperer.us-east-1.amazonaws.com"
    );
    expect(resolveKiroControlPlaneHost("eu-central-1")).toBe(
      "https://q.eu-central-1.amazonaws.com"
    );
  });
});

describe("KiroExecutor.buildUrl region routing", () => {
  it("keeps the us-east-1 registry baseUrl when no/default region", () => {
    const ex = new KiroExecutor();
    const url = ex.buildUrl("claude-sonnet-4.5", true, 0, { providerSpecificData: {} });
    expect(url).toBe("https://runtime.us-east-1.kiro.dev/generateAssistantResponse");
  });

  it("routes to the regional Amazon Q endpoint for a non-default region", () => {
    const ex = new KiroExecutor();
    const url = ex.buildUrl("claude-opus-4.8", true, 0, {
      providerSpecificData: { region: "eu-central-1" },
    });
    expect(url).toBe("https://q.eu-central-1.amazonaws.com/generateAssistantResponse");
  });
});

describe("fetchKiroProfileArn region host", () => {
  afterEach(() => vi.restoreAllMocks());

  it("queries us-east-1 codewhisperer by default", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ profiles: [{ arn: "arn:aws:codewhisperer:us-east-1:1:profile/X" }] }),
    });
    const arn = await fetchKiroProfileArn("token");
    expect(arn).toBe("arn:aws:codewhisperer:us-east-1:1:profile/X");
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://codewhisperer.us-east-1.amazonaws.com/ListAvailableProfiles"
    );
  });

  it("queries the regional Amazon Q host for a non-default region", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ profiles: [{ arn: "arn:aws:codewhisperer:eu-central-1:2:profile/Y" }] }),
    });
    const arn = await fetchKiroProfileArn("token", "eu-central-1");
    expect(arn).toBe("arn:aws:codewhisperer:eu-central-1:2:profile/Y");
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://q.eu-central-1.amazonaws.com/ListAvailableProfiles"
    );
  });
});
