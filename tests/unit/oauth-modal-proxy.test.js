import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const modalPath = fileURLToPath(new URL("../../src/shared/components/OAuthModal.js", import.meta.url));
const source = readFileSync(modalPath, "utf8");

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

  it("waits for fixed-port proxy shutdown before restarting after a pool change", () => {
    const handler = section("const handleProxyPoolChange", "// Fixed-port server-side mode");
    const restartIndex = handler.indexOf("await startOAuthFlow(proxyPoolId)");

    expect(handler).toContain("await stopFixedProxy()");
    expect(handler.indexOf("await stopFixedProxy()")).toBeLessThan(restartIndex);
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
});
