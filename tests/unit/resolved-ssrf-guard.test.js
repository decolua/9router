import { describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import {
  assertPublicAddress,
  assertPublicUrl,
  createPublicOnlyConnector,
  createPublicOnlyFetch,
  createPublicOnlyLookup,
  SSRF_BLOCKED_ERROR_CODE,
} from "../../src/shared/utils/ssrfGuard.js";

function runLookup(lookup, hostname, options = { all: true }) {
  return new Promise((resolve, reject) => {
    lookup(hostname, options, (error, address, family) => {
      if (error) reject(error);
      else resolve({ address, family });
    });
  });
}

describe("resolved SSRF guard", () => {
  it.each([
    "http://[::ffff:7f00:1]:19998",
    "http://[::ffff:a9fe:a9fe]/latest/meta-data",
    "http://[0:0:0:0:0:ffff:7f00:1]",
    "http://[::7f00:1]",
  ])("rejects IPv4-compatible or mapped private address %s", (url) => {
    expect(() => assertPublicUrl(url)).toThrow(expect.objectContaining({ code: SSRF_BLOCKED_ERROR_CODE }));
  });

  it.each([
    "127.0.0.1",
    "169.254.169.254",
    "10.0.0.1",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:7f00:1",
  ])("rejects a private DNS result %s", (address) => {
    expect(() => assertPublicAddress(address)).toThrow(expect.objectContaining({ code: SSRF_BLOCKED_ERROR_CODE }));
  });

  it.each(["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"])("allows a public DNS result %s", (address) => {
    expect(() => assertPublicAddress(address)).not.toThrow();
  });

  it("rejects a hostname when any DNS answer is private", async () => {
    const dnsLookup = vi.fn((hostname, options, callback) => callback(null, [
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]));

    await expect(runLookup(createPublicOnlyLookup(dnsLookup), "rebind.example")).rejects.toMatchObject({
      code: SSRF_BLOCKED_ERROR_CODE,
    });
    expect(dnsLookup).toHaveBeenCalledWith(
      "rebind.example",
      expect.objectContaining({ all: true, verbatim: true }),
      expect.any(Function),
    );
  });

  it("returns public DNS answers to the socket lookup", async () => {
    const answers = [
      { address: "93.184.216.34", family: 4 },
      { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
    ];
    const dnsLookup = vi.fn((hostname, options, callback) => callback(null, answers));

    await expect(runLookup(createPublicOnlyLookup(dnsLookup), "public.example")).resolves.toEqual({
      address: answers,
      family: undefined,
    });
  });

  it("blocks the real fetch socket before it reaches a DNS-rebound private service", async () => {
    let hits = 0;
    const server = createServer((request, response) => {
      hits += 1;
      response.end("internal secret");
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

    try {
      const port = server.address().port;
      const dnsLookup = vi.fn((hostname, options, callback) => callback(null, [
        { address: "127.0.0.1", family: 4 },
      ]));
      const guardedFetch = createPublicOnlyFetch(dnsLookup);

      let fetchError;
      try {
        await guardedFetch(`http://rebind.example:${port}/secret`);
      } catch (error) {
        fetchError = error;
      }

      expect(fetchError?.code || fetchError?.cause?.code).toBe(SSRF_BLOCKED_ERROR_CODE);
      expect(hits).toBe(0);
    } finally {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("blocks a redirected IP literal at the socket connector boundary", async () => {
    const connector = createPublicOnlyConnector();

    const error = await new Promise((resolve) => {
      connector({ hostname: "::ffff:7f00:1", protocol: "http:", port: "19998" }, resolve);
    });

    expect(error).toMatchObject({ code: SSRF_BLOCKED_ERROR_CODE });
  });
});
