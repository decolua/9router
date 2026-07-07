import { describe, it, expect } from "vitest";
import { mergeOauthClientConfig } from "../../src/lib/mcp/gateway/oauthClientConfig.js";

describe("mergeOauthClientConfig", () => {
  it("returns undefined and touches nothing when no credentials supplied", () => {
    const body = { slug: "x" };
    expect(mergeOauthClientConfig({ access_token: "t" }, body)).toBeUndefined();
  });

  it("strips transient form fields from the body", () => {
    const body = { slug: "x", clientId: "cid", clientSecret: "sec", scope: "mcp" };
    mergeOauthClientConfig(null, body);
    expect(body.clientId).toBeUndefined();
    expect(body.clientSecret).toBeUndefined();
    expect(body.scope).toBeUndefined();
    expect(body.slug).toBe("x");
  });

  it("creates a client bundle on first set without resetting (nothing to reset)", () => {
    const body = { clientId: "cid-1", scope: "mcp" };
    expect(mergeOauthClientConfig(null, body)).toEqual({ client: { clientId: "cid-1" }, scope: "mcp" });
  });

  it("merges into existing tokens without clobbering live token material", () => {
    const body = { clientId: "cid-2" };
    expect(mergeOauthClientConfig({ access_token: "t", refresh_token: "r", scope: "old" }, body)).toEqual({
      access_token: "t",
      refresh_token: "r",
      scope: "old",
      client: { clientId: "cid-2" },
    });
  });

  it("resets stale tokens when an existing client_id is replaced", () => {
    const body = { clientId: "new" };
    const out = mergeOauthClientConfig(
      { access_token: "t", refresh_token: "r", expires_at: 1, client: { clientId: "old" } },
      body,
    );
    expect(out.access_token).toBeUndefined();
    expect(out.refresh_token).toBeUndefined();
    expect(out.expires_at).toBeUndefined();
    expect(out.needsReauth).toBe(false);
    expect(out.client.clientId).toBe("new");
  });

  it("keeps tokens when the same client_id is re-submitted", () => {
    const body = { clientId: "same" };
    expect(mergeOauthClientConfig({ access_token: "t", client: { clientId: "same" } }, body)).toEqual({
      access_token: "t",
      client: { clientId: "same" },
    });
  });

  it("trims whitespace-only values to a no-op", () => {
    const body = { clientId: "   ", scope: "" };
    expect(mergeOauthClientConfig(null, body)).toBeUndefined();
  });
});
