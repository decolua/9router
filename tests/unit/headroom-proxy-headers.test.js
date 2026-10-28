import { describe, it, expect } from "vitest";
import { forwardedHeaders } from "../../src/app/api/headroom/proxy/[...path]/route.js";

const INTERNAL_HEADERS = {
  "x-9r-cli-token": "local-cli-secret",
  "x-9r-peer-token": "per-process-secret",
  "x-9r-real-ip": "127.0.0.1",
  "x-9r-via-proxy": "1",
};

describe("Headroom proxy header boundary", () => {
  it("never forwards 9router internal trust/auth headers, even to loopback", () => {
    const request = new Request("http://localhost/api/headroom/proxy/dashboard", {
      headers: { ...INTERNAL_HEADERS, cookie: "auth_token=session", authorization: "Bearer viewer" },
    });
    const headers = forwardedHeaders(request, new URL("http://localhost:20129"));
    for (const name of Object.keys(INTERNAL_HEADERS)) expect(headers.has(name), name).toBe(false);
    // Existing local Headroom behavior remains available.
    expect(headers.get("cookie")).toBe("auth_token=session");
    expect(headers.get("authorization")).toBe("Bearer viewer");
  });

  it("does not forward internal trust/auth headers or viewer credentials to remote Headroom", () => {
    const request = new Request("http://localhost/api/headroom/proxy/dashboard", {
      headers: { ...INTERNAL_HEADERS, cookie: "auth_token=session", authorization: "Bearer viewer" },
    });
    const headers = forwardedHeaders(request, new URL("https://headroom.example"));
    for (const name of [...Object.keys(INTERNAL_HEADERS), "cookie", "authorization"]) {
      expect(headers.has(name), name).toBe(false);
    }
  });
});
