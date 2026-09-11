import { describe, expect, it, vi } from "vitest";
import https from "https";

vi.mock("../../src/lib/tunnel/shared/dnsResolver.js", () => ({ resolveDns: vi.fn().mockResolvedValue(true) }));
vi.mock("dns", () => ({
  default: {
    Resolver: class { setServers() {} resolve4(_host, callback) { callback(null, ["203.0.113.1"]); } },
    resolve4(_host, callback) { callback(null, ["203.0.113.1"]); },
  },
}));

it("probes with the all:true lookup callback shape used by https", async () => {
  const get = vi.spyOn(https, "get").mockImplementation((_url, options, callback) => {
    options.lookup("tunnel.example", { all: true }, (error, addresses) => {
      expect(error).toBeNull();
      expect(addresses).toEqual([{ address: "203.0.113.1", family: 4 }]);
    });
    const request = { once: vi.fn() };
    callback({ statusCode: 200, resume: vi.fn() });
    return request;
  });
  const { probeUrlAlive } = await import("../../src/lib/tunnel/cloudflare/healthCheck.js");
  await expect(probeUrlAlive("https://tunnel.example")).resolves.toBe(true);
  get.mockRestore();
});
