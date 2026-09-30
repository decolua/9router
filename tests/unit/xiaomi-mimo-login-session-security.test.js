/**
 * Security invariants of the server-assisted MiMo login proxy
 * (src/lib/mimoLoginSession.js):
 *  - credentials bound to 9router's own origin are never forwarded upstream
 *  - upstream Set-Cookie is never replayed onto the app's own cookie jar
 */
import { describe, it, expect } from "vitest";
import { __test__ } from "../../src/lib/mimoLoginSession.js";

const { STRIP_UPSTREAM_HEADERS, buildBrowserResponse } = __test__;

describe("mimo login proxy security", () => {
  it("strips auth credentials and session cookies before forwarding upstream", () => {
    for (const h of ["authorization", "proxy-authorization", "cookie", "host"]) {
      expect(STRIP_UPSTREAM_HEADERS.has(h)).toBe(true);
    }
  });

  it("does not replay upstream Set-Cookie onto the app origin", async () => {
    const upstream = new Response("ok", {
      status: 200,
      headers: {
        "content-type": "text/html",
        "set-cookie": "userId=123; Path=/", // plain object header: visible via getSetCookie
      },
    });
    const out = await buildBrowserResponse({ jar: new Map() }, upstream, "http://localhost:20128", "/pass/");
    expect(out.headers.getSetCookie()).toEqual([]);
  });

  it("keeps ordinary response headers intact", async () => {
    const upstream = new Response("<html></html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });
    const out = await buildBrowserResponse({ jar: new Map() }, upstream, "http://localhost:20128", "/fe/");
    expect(out.status).toBe(200);
    expect(out.headers.get("content-type")).toBe("text/html");
  });
});
