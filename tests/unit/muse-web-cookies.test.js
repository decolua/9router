import { describe, it, expect } from "vitest";
import { toMuseCookies, parseCookiePairs } from "../../open-sse/executors/muse-web/session.js";
import { parseCookieString } from "../../open-sse/services/browserPool.js";

describe("muse-web session cookies", () => {
  it("toMuseCookies sets bare domain for __Host- prefixed cookies and dotted domain for standard cookies", () => {
    const rawCookie =
      "__Host-hatch_one_tap=xyz123; hatch_sess=abc456; hatch_native_auth_device=dev789; Path=/; Secure";
    const cookies = toMuseCookies(rawCookie);

    expect(cookies).toEqual([
      {
        name: "__Host-hatch_one_tap",
        value: "xyz123",
        domain: "muse.ai",
        path: "/",
        secure: true,
        httpOnly: false,
        sameSite: "Lax",
        expires: -1,
      },
      {
        name: "hatch_sess",
        value: "abc456",
        domain: ".muse.ai",
        path: "/",
        secure: true,
        httpOnly: false,
        sameSite: "Lax",
        expires: -1,
      },
      {
        name: "hatch_native_auth_device",
        value: "dev789",
        domain: ".muse.ai",
        path: "/",
        secure: true,
        httpOnly: false,
        sameSite: "Lax",
        expires: -1,
      },
    ]);
  });

  it("parseCookiePairs ignores standard cookie attribute names", () => {
    const raw = "__Host-test=val; domain=muse.ai; path=/; secure; httponly; samesite=lax";
    const pairs = parseCookiePairs(raw);
    expect(pairs).toEqual([{ name: "__Host-test", value: "val" }]);
  });
});

describe("browserPool parseCookieString", () => {
  it("formats __Host- cookies with bare host domain and ignores cookie attributes", () => {
    const raw = "__Host-hatch_one_tap=test1; normal_cookie=test2; path=/; secure";
    const cookies = parseCookieString(raw, ".muse.ai");

    expect(cookies).toEqual([
      {
        name: "__Host-hatch_one_tap",
        value: "test1",
        domain: "muse.ai",
        path: "/",
        expires: -1,
        httpOnly: false,
        secure: true,
        sameSite: "Lax",
      },
      {
        name: "normal_cookie",
        value: "test2",
        domain: ".muse.ai",
        path: "/",
        expires: -1,
        httpOnly: false,
        secure: true,
        sameSite: "Lax",
      },
    ]);
  });

  it("handles domains passed without leading dot", () => {
    const raw = "__Host-foo=bar; baz=qux";
    const cookies = parseCookieString(raw, "chatgpt.com");

    expect(cookies).toEqual([
      {
        name: "__Host-foo",
        value: "bar",
        domain: "chatgpt.com",
        path: "/",
        expires: -1,
        httpOnly: false,
        secure: true,
        sameSite: "Lax",
      },
      {
        name: "baz",
        value: "qux",
        domain: ".chatgpt.com",
        path: "/",
        expires: -1,
        httpOnly: false,
        secure: true,
        sameSite: "Lax",
      },
    ]);
  });
});
