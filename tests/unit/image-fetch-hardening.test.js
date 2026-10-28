import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock DNS lookup so we control which host resolves to what IP.
const lookupMock = vi.fn();
// image.js resolves with { all: true } (DNS pinning, c7d07448), which returns an array;
// a bare record made every lookup fail, so private-IP cases passed for the wrong reason.
vi.mock("node:dns/promises", () => ({
  lookup: async (host, opts) => {
    const record = await lookupMock(host, opts);
    return opts?.all ? [record] : record;
  },
}));

import { fetchImageAsBase64 } from "../../open-sse/translator/concerns/image.js";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function mockFetchOnce(bytes, ok = true) {
  const body = {
    getReader() {
      let sent = false;
      return {
        read: async () => sent ? { done: true } : (sent = true, { done: false, value: new Uint8Array(bytes) }),
        cancel: async () => {},
      };
    },
  };
  globalThis.fetch = vi.fn(async () => ({ ok, body }));
}

beforeEach(() => {
  lookupMock.mockReset();
  lookupMock.mockResolvedValue({ address: "93.184.216.34" }); // public by default
});
afterEach(() => { vi.restoreAllMocks(); });

// The SSRF cases mock a fetch that would succeed, so a null result can only come from
// the guard, and assert the request is never sent.
describe("fetchImageAsBase64 hardening", () => {
  it("rejects non-http url", async () => {
    expect(await fetchImageAsBase64("ftp://x/y.png")).toBeNull();
    expect(await fetchImageAsBase64("data:image/png;base64,xx")).toBeNull();
  });

  it("SSRF: rejects private IP (10.x)", async () => {
    lookupMock.mockResolvedValue({ address: "10.0.0.5" });
    mockFetchOnce(PNG);
    expect(await fetchImageAsBase64("http://internal.example/x.png")).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("SSRF: rejects cloud metadata 169.254.169.254", async () => {
    lookupMock.mockResolvedValue({ address: "169.254.169.254" });
    mockFetchOnce(PNG);
    expect(await fetchImageAsBase64("http://metadata/x.png")).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("SSRF: rejects blocked hostname localhost", async () => {
    expect(await fetchImageAsBase64("http://localhost/x.png")).toBeNull();
  });

  it("SSRF: rejects IPv6 loopback", async () => {
    lookupMock.mockResolvedValue({ address: "::1" });
    mockFetchOnce(PNG);
    expect(await fetchImageAsBase64("http://x/y.png")).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("accepts valid PNG from public host", async () => {
    mockFetchOnce(PNG);
    const r = await fetchImageAsBase64("https://example.com/a.png");
    expect(r).not.toBeNull();
    expect(r.mimeType).toBe("image/png");
    expect(r.url.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("rejects disguised non-image payload (magic byte mismatch)", async () => {
    mockFetchOnce(Buffer.from("<?php system($_GET[c]); ?>"));
    expect(await fetchImageAsBase64("https://example.com/evil.png")).toBeNull();
  });

  it("rejects payload over size cap", async () => {
    mockFetchOnce(Buffer.alloc(1024));
    expect(await fetchImageAsBase64("https://example.com/big.png", { maxBytes: 100 })).toBeNull();
  });

  it("returns null when fetch not ok", async () => {
    mockFetchOnce(PNG, false);
    expect(await fetchImageAsBase64("https://example.com/404.png")).toBeNull();
  });
});
