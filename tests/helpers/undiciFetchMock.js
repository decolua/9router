/**
 * Intercept the fetch proxyFetch actually calls.
 *
 * open-sse/utils/proxyFetch.js routes every outbound request through the
 * repo-root `undici` package (see rawFetch) instead of globalThis.fetch, so
 * stubbing global fetch no longer intercepts anything. The tests package also
 * has its own undici copy that shadows the bare "undici" specifier for files
 * under tests/, so a plain `vi.doMock("undici")` from a test file resolves to
 * that copy and misses the repo-root one proxyFetch imports. Register the mock
 * by the resolved absolute path of the root copy instead.
 *
 * Usage (must run before importing the module under test, after vi.resetModules):
 *   const fetchMock = vi.fn().mockResolvedValue(response);
 *   mockRootUndiciFetch(fetchMock);
 *   const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");
 */
import { createRequire } from "node:module";
import { vi } from "vitest";

const requireFromRepoRoot = createRequire(new URL("../../package.json", import.meta.url));

export const ROOT_UNDICI_ID = requireFromRepoRoot.resolve("undici");

export function mockRootUndiciFetch(fetchImpl) {
  vi.doMock(ROOT_UNDICI_ID, async () => {
    const actual = await vi.importActual(ROOT_UNDICI_ID);
    return { ...actual, fetch: fetchImpl };
  });
}

export function unmockRootUndiciFetch() {
  vi.doUnmock(ROOT_UNDICI_ID);
}
