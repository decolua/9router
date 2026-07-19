import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const modalPath = fileURLToPath(new URL("../../src/shared/components/OAuthModal.js", import.meta.url));
const source = readFileSync(modalPath, "utf8");
const selectorSource = readFileSync(fileURLToPath(new URL(
  "../../src/shared/components/OAuthProxyPoolSelector.js",
  import.meta.url,
)), "utf8");

function section(start, end) {
  return source.slice(source.indexOf(start), source.indexOf(end));
}

describe("OAuth modal proxy selection", () => {
  it("starts each login with Direct selected", () => {
    const openEffect = section("// Reset state and start OAuth", "const handleProxyPoolChange");

    expect(openEffect).not.toContain("proxyPools.find");
    expect(openEffect).toContain('setSelectedProxyPoolId("")');
    expect(openEffect).toContain('startOAuthFlow("")');
  });

  it("tracks close shutdown and waits for it before any restart", () => {
    expect(source).toContain("proxyStopPromiseRef.current = pending");
    expect(source).toContain("await proxyStopPromiseRef.current");
    expect(source).toContain("state=${encodeURIComponent(state)}");
  });

  it("sends fixed-port PKCE sessions in POST bodies", () => {
    const startFlow = section("// Codex: start proxy", "setAuthData({ ...data, redirectUri, codexServerSide, xaiServerSide })");

    expect(startFlow.match(/method: "POST"/g) || []).toHaveLength(2);
    expect(startFlow.match(/body: JSON\.stringify/g) || []).toHaveLength(2);
    expect(startFlow).not.toContain('searchParams.set("code_verifier"');
    expect(startFlow).not.toContain('searchParams.set("redirect_uri"');
  });

  it("associates proxy selector label with its select", () => {
    expect(selectorSource).toContain("const selectId =");
    expect(selectorSource).toContain("htmlFor={selectId}");
    expect(selectorSource).toContain("id={selectId}");
  });

  it("rejects callback state that does not match the active authorization", () => {
    const callback = section("// Handler for callback data", "// Method 1: postMessage");

    expect(callback).toContain("state !== authData.state");
    expect(callback).toContain("OAuth state mismatch");
  });
});
