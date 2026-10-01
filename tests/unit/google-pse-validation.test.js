import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, it, expect, vi } from "vitest";
import googlePse from "../../open-sse/providers/registry/google-pse.js";
import { buildSearchRequest } from "../../open-sse/handlers/search/callers.js";

// Run the actual probe functions without loading database/proxy runtime modules.
// Only their external dependencies are replaced; the function bodies are unchanged.
function loadProbes(fetch) {
  const validation = readFileSync(new URL("../../src/app/api/providers/validate/route.js", import.meta.url), "utf8");
  const saved = readFileSync(new URL("../../src/app/api/providers/[id]/test/testUtils.js", import.meta.url), "utf8");
  const probeSource = validation.slice(validation.indexOf("async function probeWebProvider("), validation.indexOf("// Probe a media provider"));
  const savedSource = saved.slice(saved.indexOf("async function testApiKeyConnection("), saved.indexOf("/**\n * Test a single connection"));
  return vm.runInNewContext(`${probeSource}\n${savedSource}\n({probeWebProvider, testApiKeyConnection})`, {
    AI_PROVIDERS: { "google-pse": googlePse },
    buildSearchRequest,
    fetch,
    fetchWithConnectionProxy: fetch,
    AbortSignal,
    URLSearchParams,
    isOpenAICompatibleProvider: () => false,
    isAnthropicCompatibleProvider: () => false,
  });
}

describe("Google PSE connection probes", () => {
  it("validates with the configured engine ID instead of a placeholder", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("{}"));
    const { probeWebProvider } = loadProbes(fetch);
    expect(await probeWebProvider("google-pse", "test-key", { cx: "engine:123&x", baseUrl: "https://override.invalid" })).toBe(true);
    const url = new URL(fetch.mock.calls[0][0]);
    expect(url.origin).toBe("https://www.googleapis.com");
    expect(url.searchParams.get("cx")).toBe("engine:123&x");
    expect(url.searchParams.get("key")).toBe("test-key");
    expect(url.searchParams.get("q")).toBe("ping");
  });

  it("rejects missing engine ID without making a request", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("{}"));
    await expect(loadProbes(fetch).probeWebProvider("google-pse", "test-key", {})).rejects.toThrow(/cx/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([400, 401, 403, 429, 500])("does not mark an HTTP %s Google probe as valid", async (status) => {
    const fetch = vi.fn().mockResolvedValue(new Response("{}", { status }));
    expect(await loadProbes(fetch).probeWebProvider("google-pse", "test-key", { cx: "engine" })).toBe(false);
  });

  it("tests a saved engine through the connection proxy fetcher", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("{}"));
    const proxy = { connectionProxyEnabled: true, connectionProxyUrl: "http://proxy.invalid" };
    const result = await loadProbes(fetch).testApiKeyConnection({ provider: "google-pse", apiKey: "test-key", providerSpecificData: { cx: "saved-engine" } }, proxy);
    expect(result.valid).toBe(true);
    expect(new URL(fetch.mock.calls[0][0]).searchParams.get("cx")).toBe("saved-engine");
    expect(fetch.mock.calls[0][2]).toBe(proxy);
  });

  it("rejects a saved connection missing its engine without fetching", async () => {
    const fetch = vi.fn();
    const result = await loadProbes(fetch).testApiKeyConnection({ provider: "google-pse", apiKey: "test-key" });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/cx/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not mark a saved invalid engine as active", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("{}", { status: 400 }));
    const result = await loadProbes(fetch).testApiKeyConnection({ provider: "google-pse", apiKey: "test-key", providerSpecificData: { cx: "bad-engine" } });
    expect(result.valid).toBe(false);
  });

  it("leaves unsupported providers on their existing path", async () => {
    const fetch = vi.fn();
    const probes = loadProbes(fetch);
    expect(await probes.probeWebProvider("unknown", "test-key")).toBeNull();
    expect((await probes.testApiKeyConnection({ provider: "unknown" })).error).toBe("Provider test not supported");
    expect(fetch).not.toHaveBeenCalled();
  });
});
