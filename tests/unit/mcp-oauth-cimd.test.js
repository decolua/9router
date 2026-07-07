import { describe, it, expect } from "vitest";
import {
  cimdClientId,
  cimdRedirectUri,
  buildClientMetadataDocument,
  isPubliclyFetchableBase,
} from "../../src/lib/mcp/gateway/oauthCimd.js";

describe("CIMD helpers", () => {
  const base = "https://llm.example.com";
  const id = "abc-123";

  it("derives a per-instance client_id and redirect_uri", () => {
    expect(cimdClientId(base, id)).toBe("https://llm.example.com/api/mcp-gateway/oauth/abc-123/client-metadata");
    expect(cimdRedirectUri(base, id)).toBe("https://llm.example.com/api/mcp-gateway/oauth/abc-123/callback");
  });

  it("builds a document whose client_id equals its own URL", () => {
    const doc = buildClientMetadataDocument({ base, instanceId: id, slug: "granola", scope: "mcp" });
    expect(doc.client_id).toBe(cimdClientId(base, id));
    expect(doc.redirect_uris).toEqual([cimdRedirectUri(base, id)]);
    expect(doc.client_name).toBe("9router MCP Gateway (granola)");
    expect(doc.token_endpoint_auth_method).toBe("none");
    expect(doc.scope).toBe("mcp");
  });

  it("omits scope when not provided", () => {
    const doc = buildClientMetadataDocument({ base, instanceId: id });
    expect("scope" in doc).toBe(false);
  });

  it("accepts public https origins", () => {
    expect(isPubliclyFetchableBase("https://llm.example.com")).toBe(true);
    expect(isPubliclyFetchableBase("https://mcp.granola.ai")).toBe(true);
  });

  it("rejects loopback / non-fetchable origins", () => {
    expect(isPubliclyFetchableBase("http://127.0.0.1:11434")).toBe(false);
    expect(isPubliclyFetchableBase("https://localhost:11434")).toBe(false);
    expect(isPubliclyFetchableBase("http://[::1]:11434")).toBe(false);
    expect(isPubliclyFetchableBase("not a url")).toBe(false);
  });
});
