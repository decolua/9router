/**
 * Unit tests for open-sse/config/kiroRegions.js — the single source of truth
 * for Kiro's regional endpoint topology.
 */
import { describe, it, expect } from "vitest";
import {
  KIRO_DEFAULT_REGION,
  regionFromProfileArn,
  resolveKiroRegion,
  buildKiroBaseUrls,
  buildKiroProfileEndpoint,
  buildKiroOidcEndpoint,
  alignProfileArnRegion,
} from "../../open-sse/config/kiroRegions.js";
import { resolveKiroProfileArn } from "../../open-sse/config/kiroConstants.js";

const EU = "eu-central-1";
const US = "us-east-1";
const arn = (r) => `arn:aws:codewhisperer:${r}:966063511238:profile/QN4AXVDKDEX7`;

describe("regionFromProfileArn", () => {
  it("extracts the region segment", () => {
    expect(regionFromProfileArn(arn(EU))).toBe(EU);
    expect(regionFromProfileArn(arn(US))).toBe(US);
  });
  it("returns null for junk", () => {
    expect(regionFromProfileArn(null)).toBeNull();
    expect(regionFromProfileArn("not-an-arn")).toBeNull();
    expect(regionFromProfileArn(123)).toBeNull();
  });
});

describe("resolveKiroRegion", () => {
  it("prefers explicit region", () => {
    expect(resolveKiroRegion({ providerSpecificData: { region: EU, profileArn: arn(US) } })).toBe(EU);
  });
  it("falls back to profileArn region", () => {
    expect(resolveKiroRegion({ providerSpecificData: { profileArn: arn(EU) } })).toBe(EU);
  });
  it("defaults to us-east-1", () => {
    expect(resolveKiroRegion({})).toBe(US);
    expect(resolveKiroRegion(null)).toBe(US);
  });
});

describe("buildKiroBaseUrls", () => {
  it("includes codewhisperer only for us-east-1", () => {
    const urls = buildKiroBaseUrls(US);
    expect(urls).toEqual([
      "https://runtime.us-east-1.kiro.dev/generateAssistantResponse",
      "https://codewhisperer.us-east-1.amazonaws.com/generateAssistantResponse",
      "https://q.us-east-1.amazonaws.com/generateAssistantResponse",
    ]);
  });
  it("excludes codewhisperer for other regions and rewrites region", () => {
    const urls = buildKiroBaseUrls(EU);
    expect(urls).toEqual([
      "https://runtime.eu-central-1.kiro.dev/generateAssistantResponse",
      "https://q.eu-central-1.amazonaws.com/generateAssistantResponse",
    ]);
    expect(urls.some((u) => u.includes("codewhisperer"))).toBe(false);
    expect(urls.every((u) => u.includes(EU))).toBe(true);
  });
  it("defaults to us-east-1 when no region given", () => {
    expect(buildKiroBaseUrls()).toEqual(buildKiroBaseUrls(US));
  });
});

describe("buildKiroProfileEndpoint", () => {
  it("uses codewhisperer host for us-east-1", () => {
    expect(buildKiroProfileEndpoint(US)).toBe("https://codewhisperer.us-east-1.amazonaws.com");
  });
  it("uses q host for other regions", () => {
    expect(buildKiroProfileEndpoint(EU)).toBe("https://q.eu-central-1.amazonaws.com");
  });
});

describe("buildKiroOidcEndpoint", () => {
  it("is region-scoped", () => {
    expect(buildKiroOidcEndpoint(EU)).toBe("https://oidc.eu-central-1.amazonaws.com/token");
    expect(buildKiroOidcEndpoint()).toBe("https://oidc.us-east-1.amazonaws.com/token");
  });
});

describe("alignProfileArnRegion", () => {
  it("rewrites the region segment to match", () => {
    expect(alignProfileArnRegion(arn(US), EU)).toBe(arn(EU));
    expect(alignProfileArnRegion(arn(EU), US)).toBe(arn(US));
  });
  it("is a no-op when already aligned", () => {
    expect(alignProfileArnRegion(arn(EU), EU)).toBe(arn(EU));
  });
  it("handles empty input", () => {
    expect(alignProfileArnRegion("", EU)).toBe("");
    expect(alignProfileArnRegion(null, EU)).toBe("");
  });
});

describe("resolveKiroProfileArn (integration with kiroConstants)", () => {
  it("aligns a stored us-east-1 ARN to the EU credential region (self-heal)", () => {
    const creds = { providerSpecificData: { region: EU, authMethod: "idc", profileArn: arn(US) } };
    expect(resolveKiroProfileArn(creds)).toBe(arn(EU));
  });
  it("keeps a correct EU ARN as-is", () => {
    const creds = { providerSpecificData: { region: EU, authMethod: "idc", profileArn: arn(EU) } };
    expect(resolveKiroProfileArn(creds)).toBe(arn(EU));
  });
  it("never returns the shared default for api_key without an ARN", () => {
    const creds = { providerSpecificData: { region: US, authMethod: "api_key" } };
    expect(resolveKiroProfileArn(creds)).toBe("");
  });
  it("uses the shared default for us-east-1 builder-id without an ARN", () => {
    const creds = { providerSpecificData: { region: US, authMethod: "builder-id" } };
    expect(resolveKiroProfileArn(creds)).toContain("arn:aws:codewhisperer:us-east-1:");
  });
  it("returns empty for a non-us-east-1 credential without an ARN (resolved on refresh instead)", () => {
    const creds = { providerSpecificData: { region: EU, authMethod: "idc" } };
    expect(resolveKiroProfileArn(creds)).toBe("");
  });
});
