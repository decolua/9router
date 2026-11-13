import { describe, expect, it, vi } from "vitest";

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

describe("Vertex thinking suffixes", () => {
  it.each(["low", "medium", "high"])("omits (%s) from raw-key and OAuth model URLs", (level) => {
    const executor = new VertexExecutor();
    for (const credentials of [
      { apiKey: "test-key" },
      { accessToken: "test-token", providerSpecificData: { projectId: "test-project", location: "global" } },
    ]) {
      for (const stream of [false, true]) {
        const url = new URL(executor.buildUrl(`gemini-4-argon(${level})`, stream, 0, credentials));
        expect(url.pathname.endsWith(`/models/gemini-4-argon:${stream ? "streamGenerateContent" : "generateContent"}`)).toBe(true);
        expect(url.searchParams.get("key")).toBe(credentials.apiKey || null);
        expect(url.searchParams.get("alt")).toBe(stream ? "sse" : null);
      }
    }
  });
});
