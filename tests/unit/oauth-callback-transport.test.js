import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const callbackSource = readFileSync(fileURLToPath(new URL(
  "../../src/app/callback/page.js",
  import.meta.url,
)), "utf8");
const modalSource = readFileSync(fileURLToPath(new URL(
  "../../src/shared/components/OAuthModal.js",
  import.meta.url,
)), "utf8");

describe("OAuth callback transport", () => {
  it("uses direct opener messaging without durable browser storage", () => {
    expect(callbackSource).toContain("window.opener.postMessage");
    expect(callbackSource).not.toContain("localStorage");
    expect(callbackSource).not.toContain("sessionStorage");
    expect(callbackSource).not.toContain("BroadcastChannel");
    expect(callbackSource).not.toContain("fullUrl:");

    expect(modalSource).not.toContain("localStorage");
    expect(modalSource).not.toContain("sessionStorage");
    expect(modalSource).not.toContain("BroadcastChannel");
    expect(modalSource).not.toContain('addEventListener("storage"');
  });

  it("validates callback origins by exact parsed loopback identity", async () => {
    const origins = await import("../../src/lib/oauth/callbackOrigins.js").catch(() => null);

    expect(origins?.isPermittedOAuthOpenerOrigin).toBeTypeOf("function");
    expect(origins?.isPermittedOAuthOpenerOrigin(
      "http://localhost:20127",
      "http://127.0.0.1:20127",
    )).toBe(true);
    expect(origins?.isPermittedOAuthOpenerOrigin(
      "http://127.0.0.1:20127",
      "http://localhost:20127",
    )).toBe(true);
    expect(origins?.isPermittedOAuthOpenerOrigin(
      "http://localhost.evil.test:20127",
      "http://localhost:20127",
    )).toBe(false);
    expect(origins?.isPermittedOAuthOpenerOrigin(
      "http://127.0.0.1.evil.test:20127",
      "http://localhost:20127",
    )).toBe(false);
    expect(origins?.isPermittedOAuthOpenerOrigin(
      "http://localhost:9999",
      "http://localhost:20127",
    )).toBe(false);
    expect(modalSource).not.toContain('origin.includes("localhost")');
    expect(modalSource).not.toContain('origin.includes("127.0.0.1")');
  });
});
