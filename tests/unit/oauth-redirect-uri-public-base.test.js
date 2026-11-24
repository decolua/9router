import { describe, expect, it } from "vitest";

import {
  buildOAuthRedirectUri,
  isLoopbackHostname,
  publicBaseUrl,
} from "../../src/lib/oauth/redirectUri.js";

// A TLS-terminating reverse proxy in front of 9Router: the dashboard is reached
// at https://router.ai.public.domain, so window.location.port is "" and the
// implicit port is 443. See issue #4054.
const httpsPublic = {
  hostname: "router.ai.public.domain",
  port: "",
  protocol: "https:",
  origin: "https://router.ai.public.domain",
};

const localhostApp = {
  hostname: "localhost",
  port: "20128",
  protocol: "http:",
  origin: "http://localhost:20128",
};

describe("isLoopbackHostname", () => {
  it("recognises every loopback spelling", () => {
    for (const host of ["localhost", "127.0.0.1", "::1", "[::1]", "LOCALHOST", " Localhost "]) {
      expect(isLoopbackHostname(host)).toBe(true);
    }
  });

  it("does not treat a routable host as loopback", () => {
    for (const host of ["router.ai.public.domain", "9router.internal", "192.168.1.10", "0.0.0.0", "", null]) {
      expect(isLoopbackHostname(host)).toBe(false);
    }
  });
});

describe("publicBaseUrl", () => {
  it("returns the origin without a trailing slash", () => {
    expect(publicBaseUrl({ origin: "https://router.example.com" })).toBe("https://router.example.com");
    expect(publicBaseUrl({ origin: "https://router.example.com/" })).toBe("https://router.example.com");
  });

  it("rebuilds from protocol and host when origin is unavailable", () => {
    expect(
      publicBaseUrl({ protocol: "https:", host: "router.example.com:8443", origin: "" }),
    ).toBe("https://router.example.com:8443");
  });
});

describe("buildOAuthRedirectUri", () => {
  // The regression: the old code hardcoded http://localhost and took the port
  // from the public origin's scheme, producing http://localhost:443/callback.
  // The authorization server sent the browser to a loopback origin that does
  // not exist on the client, so the consent flow failed with
  // ERR_CONNECTION_REFUSED even though the code itself was still valid.
  it("redirects to the public base URL on an https deployment", () => {
    const redirectUri = buildOAuthRedirectUri(httpsPublic, "claude");
    expect(redirectUri).toBe("https://router.ai.public.domain/callback");
    expect(redirectUri).not.toContain("localhost");
    expect(redirectUri).not.toContain("127.0.0.1");
  });

  it("never emits the implicit-port loopback URL from #4054", () => {
    expect(buildOAuthRedirectUri(httpsPublic, "claude")).not.toBe("http://localhost:443/callback");
  });

  it("keeps the explicit port of a remote http deployment", () => {
    expect(
      buildOAuthRedirectUri(
        { hostname: "10.0.0.5", port: "20128", protocol: "http:", origin: "http://10.0.0.5:20128" },
        "claude",
      ),
    ).toBe("http://10.0.0.5:20128/callback");
  });

  it("keeps the loopback callback for a localhost install", () => {
    expect(buildOAuthRedirectUri(localhostApp, "claude")).toBe("http://localhost:20128/callback");
  });

  it("falls back to the implicit port on a bare loopback install", () => {
    expect(
      buildOAuthRedirectUri(
        { hostname: "localhost", port: "", protocol: "http:", origin: "http://localhost" },
        "claude",
      ),
    ).toBe("http://localhost:80/callback");
    expect(
      buildOAuthRedirectUri(
        { hostname: "127.0.0.1", port: "", protocol: "https:", origin: "https://127.0.0.1" },
        "claude",
      ),
    ).toBe("http://127.0.0.1:443/callback");
  });

  it("leaves the fixed-port loopback redirects for codex and xai untouched", () => {
    expect(buildOAuthRedirectUri(httpsPublic, "codex")).toBe("http://localhost:1455/auth/callback");
    expect(buildOAuthRedirectUri(httpsPublic, "xai")).toBe("http://127.0.0.1:56121/callback");
  });

  it("follows the public base URL for every non-fixed-port provider", () => {
    for (const provider of ["claude", "gemini-cli", "iflow", "qoder", "cursor", "kimi", "zed"]) {
      expect(buildOAuthRedirectUri(httpsPublic, provider)).toBe(
        "https://router.ai.public.domain/callback",
      );
    }
  });
});