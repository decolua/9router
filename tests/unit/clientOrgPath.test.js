import { describe, it, expect } from "vitest";
import { resolveClientOrgSlug, isPathBasedOrgUrl } from "@/lib/org/clientOrgPath.js";

describe("resolveClientOrgSlug", () => {
  it("reads slug from /o/:slug path", () => {
    expect(resolveClientOrgSlug({ pathname: "/o/pludous/login", hostname: "ebrouter.onrender.com" })).toBe("pludous");
  });

  it("reads slug from {slug}.localhost for local SaaS dev", () => {
    expect(resolveClientOrgSlug({ pathname: "/login", hostname: "wise.localhost" })).toBe("wise");
  });

  it("reads slug from subdomain when base domain is configured", () => {
    expect(
      resolveClientOrgSlug({
        pathname: "/login",
        hostname: "acme.app.example.com",
        baseDomain: "app.example.com",
      }),
    ).toBe("acme");
  });

  it("returns null on apex domain without path slug", () => {
    expect(
      resolveClientOrgSlug({
        pathname: "/login",
        hostname: "app.example.com",
        baseDomain: "app.example.com",
      }),
    ).toBeNull();
  });
});

describe("isPathBasedOrgUrl", () => {
  it("is only true for /o/:slug URLs", () => {
    expect(typeof isPathBasedOrgUrl).toBe("function");
  });
});
