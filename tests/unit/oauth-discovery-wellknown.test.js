import { describe, it, expect } from "vitest";
import { resolveWellKnownUrl } from "@/lib/mcp/gateway/oauthDiscovery";

describe("resolveWellKnownUrl", () => {
  it("appends well-known path for bare origin AS URL", () => {
    expect(resolveWellKnownUrl("https://mcp-auth.granola.ai")).toBe(
      "https://mcp-auth.granola.ai/.well-known/oauth-authorization-server"
    );
  });

  it("keeps AS URL that already has well-known path", () => {
    const url = "https://as.example.com/.well-known/oauth-authorization-server";
    expect(resolveWellKnownUrl(url)).toBe(url);
  });

  it("appends well-known path for AS URL with other path", () => {
    expect(resolveWellKnownUrl("https://as.example.com/oauth2")).toBe(
      "https://as.example.com/.well-known/oauth-authorization-server"
    );
  });

  it("handles AS URL with realm path", () => {
    expect(resolveWellKnownUrl("https://as.example.com/realm/master")).toBe(
      "https://as.example.com/.well-known/oauth-authorization-server"
    );
  });

  it("returns null for invalid URL", () => {
    expect(resolveWellKnownUrl("not-a-url")).toBeNull();
  });
});
