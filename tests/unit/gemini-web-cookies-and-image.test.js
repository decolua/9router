import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";
import {
  normalizeGeminiCookieInput,
  normalizeGeminiValidationCookie,
} from "../../open-sse/utils/geminiCookies.js";
import { mergeRotatedGoogleCookies } from "../../open-sse/executors/gemini-web.js";
import { waitForGeminiImage } from "../../open-sse/executors/gemini-web/imageGen.js";

describe("gemini-web Cookie-Editor JSON normalization", () => {
  it("parses Cookie-Editor JSON array into a Cookie header", () => {
    const raw = JSON.stringify([
      { name: "__Secure-1PSID", value: "psid-val", domain: ".google.com", path: "/" },
      { name: "__Secure-1PSIDTS", value: "ts-val", domain: ".google.com", path: "/" },
    ]);
    expect(normalizeGeminiCookieInput(raw)).toBe(
      "__Secure-1PSID=psid-val; __Secure-1PSIDTS=ts-val"
    );
    expect(normalizeGeminiValidationCookie(raw)).toBe(
      "__Secure-1PSID=psid-val; __Secure-1PSIDTS=ts-val"
    );
  });

  it("parses { cookies: [...] } export into a Cookie header", () => {
    const raw = JSON.stringify({
      cookies: [
        { name: "__Secure-1PSID", value: "psid-val" },
        { name: "SIDCC", value: "sidcc-val" },
      ],
    });
    expect(normalizeGeminiCookieInput(raw)).toBe(
      "__Secure-1PSID=psid-val; SIDCC=sidcc-val"
    );
  });

  it("preserves legacy { name: value } object map support", () => {
    const raw = JSON.stringify({
      "__Secure-1PSID": "psid-val",
      "__Secure-1PSIDTS": "ts-val",
    });
    expect(normalizeGeminiCookieInput(raw)).toBe(
      "__Secure-1PSID=psid-val; __Secure-1PSIDTS=ts-val"
    );
  });
});

describe("gemini-web rotated cookie merging", () => {
  it("updates rotated Google cookies and preserves non-rotated ones", () => {
    const original = "__Secure-1PSID=psid1; __Secure-1PSIDTS=old-ts; SIDCC=old-sidcc";
    const contextCookies = [
      { name: "__Secure-1PSIDTS", value: "new-ts", domain: ".google.com" },
      { name: "SIDCC", value: "new-sidcc", domain: ".google.com" },
      { name: "__Secure-1PSIDCC", value: "new-1psidcc", domain: ".google.com" },
      { name: "OTHER", value: "ignored", domain: ".example.com" },
    ];
    expect(mergeRotatedGoogleCookies(original, contextCookies)).toBe(
      "__Secure-1PSID=psid1; __Secure-1PSIDTS=new-ts; SIDCC=new-sidcc; __Secure-1PSIDCC=new-1psidcc"
    );
  });
});

describe("gemini-web imageGen 403 fast-fail", () => {
  it("fails fast when lh3.googleusercontent.com/rd-gg returns 403", async () => {
    const emitter = new EventEmitter();
    const page = {
      on: (ev, fn) => emitter.on(ev, fn),
      off: (ev, fn) => emitter.off(ev, fn),
      evaluate: async () => ({
        count: 1,
        generating: false,
        images: [],
        failedImages: [{ src: "https://lh3.googleusercontent.com/gg/abc=s0", w: 0, h: 0, complete: true }],
      }),
    };

    setTimeout(() => {
      emitter.emit("response", {
        url: () => "https://lh3.googleusercontent.com/rd-gg/token123",
        status: () => 403,
      });
    }, 5);

    await expect(
      waitForGeminiImage(page, { timeoutMs: 5000, pollIntervalMs: 20 })
    ).rejects.toThrow(/403 Forbidden/);
  });
});
