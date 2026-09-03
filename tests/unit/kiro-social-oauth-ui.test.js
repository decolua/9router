import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const wrapperSource = readFileSync(fileURLToPath(new URL(
  "../../src/shared/components/KiroOAuthWrapper.js",
  import.meta.url,
)), "utf8");
const modalSource = readFileSync(fileURLToPath(new URL(
  "../../src/shared/components/KiroSocialOAuthModal.js",
  import.meta.url,
)), "utf8");

describe("Kiro social OAuth proxy UI wiring", () => {
  it("passes pool readiness into social modal without wrapping another modal", () => {
    const socialBranch = wrapperSource.slice(
      wrapperSource.indexOf("if (authMethod === \"social\""),
      wrapperSource.indexOf("return null"),
    );

    expect(socialBranch).toContain("proxyPools={proxyPools}");
    expect(socialBranch).toContain("proxyPoolsReady={proxyPoolsReady}");
    expect(socialBranch).not.toContain("<Modal");
  });

  it("reuses proxy selector and sends selected pool only during authorize", () => {
    expect(modalSource).toContain("<OAuthProxyPoolSelector");
    expect(modalSource).toContain("if (!proxyPoolsReady) return");
    expect(modalSource).toContain('searchParams.set("proxyPoolId", selectedProxyPoolId)');
    const exchangeStart = modalSource.indexOf('fetch("/api/oauth/kiro/social-exchange"');
    const exchange = modalSource.slice(
      exchangeStart,
      modalSource.indexOf("const data = await res.json()", exchangeStart),
    );
    expect(exchange).not.toContain("codeVerifier");
    expect(exchange).not.toContain("proxyPoolId");
    expect(exchange).toContain("state");
  });

  it("fences authorize and exchange work by flow generation", () => {
    expect(modalSource).toContain("flowGenerationRef");
    expect(modalSource).toContain("generation !== flowGenerationRef.current");
  });

  it("rejects missing or mismatched callback state before exchange", () => {
    expect(modalSource).toContain("!state || state !== authData.state");
    expect(modalSource.indexOf("!state || state !== authData.state"))
      .toBeLessThan(modalSource.indexOf('fetch("/api/oauth/kiro/social-exchange"'));
  });
});
