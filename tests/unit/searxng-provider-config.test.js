import { afterEach, describe, expect, it, vi } from "vitest";

const originalSearxngUrl = process.env.SEARXNG_URL;

async function loadProvider(url) {
  if (url === undefined) delete process.env.SEARXNG_URL;
  else process.env.SEARXNG_URL = url;
  vi.resetModules();
  return (await import("../../open-sse/providers/registry/searxng.js")).default;
}

afterEach(() => {
  if (originalSearxngUrl === undefined) delete process.env.SEARXNG_URL;
  else process.env.SEARXNG_URL = originalSearxngUrl;
  vi.resetModules();
});

describe("SearXNG provider configuration", () => {
  it("uses SEARXNG_URL when the deployment config supplies one", async () => {
    const provider = await loadProvider("http://searxng:8080/search");

    expect(provider.searchConfig.baseUrl).toBe("http://searxng:8080/search");
  });

  it("preserves the loopback default when SEARXNG_URL is unset", async () => {
    const provider = await loadProvider(undefined);

    expect(provider.searchConfig.baseUrl).toBe("http://localhost:8888/search");
  });
});
