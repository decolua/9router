import { describe, it, expect } from "vitest";
import { isTrustedOAuthMessageOrigin } from "../../src/shared/utils/oauthOrigin.js";

describe("isTrustedOAuthMessageOrigin", () => {
  it("allows exact same origin", () => {
    expect(isTrustedOAuthMessageOrigin("https://router.example.com", "https://router.example.com")).toBe(true);
  });

  it("allows loopback origins on any port", () => {
    expect(isTrustedOAuthMessageOrigin("http://localhost:20128", "https://router.example.com")).toBe(true);
    expect(isTrustedOAuthMessageOrigin("http://127.0.0.1:56121", "https://router.example.com")).toBe(true);
    expect(isTrustedOAuthMessageOrigin("http://[::1]:1455", "https://router.example.com")).toBe(true);
  });

  it("rejects origins that only contain loopback text", () => {
    expect(isTrustedOAuthMessageOrigin("https://localhost.evil.example", "https://router.example.com")).toBe(false);
    expect(isTrustedOAuthMessageOrigin("https://127.0.0.1.evil.example", "https://router.example.com")).toBe(false);
  });
});
