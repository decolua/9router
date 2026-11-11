// Test helper: upstream v0.5.116 made proxyAwareFetch route through the
// package's own undici instance (`(await import("undici")).fetch`) instead of
// globalThis.fetch, so stubbing the global no longer intercepts executor
// traffic. This helper registers the canonical undici mock around a fetch
// implementation and yields the mock function.
import { vi } from "vitest";

/**
 * Mock the `undici` package's fetch (what proxyAwareFetch actually calls).
 * Call inside a test AFTER building the fetch implementation, then import
 * the modules under test (vi.resetModules first for a clean registry).
 * Returns the vi.fn wrapper so call assertions work as before.
 */
export function mockUndiciFetch(impl) {
  const fn = vi.fn(impl);
  vi.doMock("undici", async () => {
    const actual = await vi.importActual("undici");
    return { ...actual, fetch: fn };
  });
  return fn;
}
