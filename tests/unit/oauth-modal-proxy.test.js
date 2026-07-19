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

    expect(handler).toContain('await fetch("/api/oauth/codex/stop-proxy")');
    expect(handler).toContain('await fetch("/api/oauth/xai/stop-proxy")');
    expect(handler.indexOf('await fetch("/api/oauth/codex/stop-proxy")')).toBeLessThan(restartIndex);
    expect(handler.indexOf('await fetch("/api/oauth/xai/stop-proxy")')).toBeLessThan(restartIndex);
  });

  it("sends fixed-port PKCE sessions in POST bodies", () => {
    const startFlow = section("// Codex: start proxy", "setAuthData({ ...data, redirectUri, codexServerSide, xaiServerSide })");

    expect(startFlow.match(/method: "POST"/g) || []).toHaveLength(2);
    expect(startFlow.match(/body: JSON\.stringify/g) || []).toHaveLength(2);
    expect(startFlow).not.toContain('searchParams.set("code_verifier"');
    expect(startFlow).not.toContain('searchParams.set("redirect_uri"');
  });
});
