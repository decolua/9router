import { describe, expect, it, vi } from "vitest";

// Isolate URL construction from token minting and network dependencies.
vi.mock("../../open-sse/executors/base.js", () => ({
  BaseExecutor: class { constructor(provider) { this.provider = provider; } },
}));
vi.mock("../../open-sse/config/providers.js", () => ({ PROVIDERS: {} }));
vi.mock("../../open-sse/services/tokenRefresh.js", () => ({
  parseVertexSaJson: () => null,
  refreshVertexToken: vi.fn(),
  refreshGoogleToken: vi.fn(),
}));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: vi.fn() }));

import { VertexExecutor } from "../../open-sse/executors/vertex.js";

describe("Vertex API-key locations", () => {
  it.each([false, true])("uses the configured global location (stream=%s)", (stream) => {
    const executor = new VertexExecutor();
    const url = new URL(executor.buildUrl("gemini-4-argon", stream, 0, {
      apiKey: "test-key",
      providerSpecificData: { projectId: "test-project", location: "global" },
    }));
    expect(url.hostname).toBe("aiplatform.googleapis.com");
    expect(url.pathname).toBe(`/v1/projects/test-project/locations/global/publishers/google/models/gemini-4-argon:${stream ? "streamGenerateContent" : "generateContent"}`);
    expect(url.searchParams.get("key")).toBe("test-key");
    expect(url.searchParams.get("alt")).toBe(stream ? "sse" : null);
  });

  it("defaults an explicitly scoped API-key connection to global", () => {
    const url = new VertexExecutor().buildUrl("gemini-4-argon", false, 0, {
      apiKey: "test-key", providerSpecificData: { projectId: "test-project" },
    });
    expect(new URL(url).pathname).toContain("/projects/test-project/locations/global/");
  });

  it("honors other explicitly configured locations", () => {
    const url = new VertexExecutor().buildUrl("gemini-2.5-flash", false, 0, {
      apiKey: "test-key", providerSpecificData: { projectId: "test-project", location: "eu" },
    });
    expect(new URL(url).pathname).toContain("/locations/eu/");
  });

  it("preserves the projectless endpoint for existing API-key connections", () => {
    expect(new VertexExecutor().buildUrl("gemini-2.5-flash", false, 0, { apiKey: "test-key" }))
      .toBe("https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-2.5-flash:generateContent?key=test-key");
  });

  it("preserves OAuth regional routing and bearer authentication", () => {
    const executor = new VertexExecutor();
    const credentials = { accessToken: "test-token", providerSpecificData: { projectId: "test-project", location: "us-central1" } };
    const url = new URL(executor.buildUrl("gemini-2.5-flash", false, 0, credentials));
    expect(url.pathname).toContain("/locations/us-central1/");
    expect(url.searchParams.has("key")).toBe(false);
    expect(executor.buildHeaders(credentials, false).Authorization).toBe("Bearer test-token");
  });

  it("defaults OAuth/SA connections to the registry location for global-only models (Argon)", () => {
    const url = new URL(new VertexExecutor().buildUrl("gemini-4-argon", false, 0, {
      accessToken: "test-token", providerSpecificData: { projectId: "test-project" },
    }));
    expect(url.pathname).toContain("/locations/global/");
  });

  it("preserves the partner endpoint", () => {
    expect(new VertexExecutor("vertex-partner").buildUrl("partner-model", false, 0, {
      apiKey: "test-key", providerSpecificData: { projectId: "test-project", location: "eu" },
    })).toBe("https://aiplatform.googleapis.com/v1/projects/test-project/locations/global/endpoints/openapi/chat/completions?key=test-key");
  });
});
