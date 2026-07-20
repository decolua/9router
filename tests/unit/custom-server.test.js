import fs from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

const nodeRequire = createRequire(import.meta.url);

describe("custom server request-origin wrapper", () => {
  it("strips attacker headers and stamps a per-process proof", () => {
    const source = fs.readFileSync(new URL("../../custom-server.js", import.meta.url), "utf8");
    const originalCreateServer = vi.fn((...args) => ({ args }));
    const http = { createServer: originalCreateServer };
    const resolveTrustedClientIp = vi.fn(() => ({
      ip: "127.0.0.1",
      source: "socket",
      viaProxy: false,
    }));
    const clientIp = {
      ...nodeRequire("../../client-ip.js"),
      resolveTrustedClientIp,
    };
    const process = {
      argv: ["node", "custom-server.js"],
      env: { TRUST_PROXY: "false" },
    };
    const context = vm.createContext({
      Buffer,
      console,
      module: { exports: {} },
      exports: {},
      process,
      require(id) {
        if (id === "http" || id === "node:http") return http;
        if (id === "node:crypto") return nodeRequire(id);
        if (id === "node:fs") return nodeRequire(id);
        if (id === "node:path") return nodeRequire(id);
        if (id === "./client-ip.js") return clientIp;
        return {};
      },
    });

    vm.runInContext(source, context);
    const downstream = vi.fn();
    const server = http.createServer(downstream);
    const wrapped = server.args.at(-1);
    const req = {
      socket: { remoteAddress: "127.0.0.1" },
      headers: {
        "x-9r-real-ip": "127.0.0.1",
        "x-9r-request-proof": "attacker-proof",
        "x-forwarded-for": "198.51.100.77",
      },
    };

    wrapped(req, {});

    expect(resolveTrustedClientIp).toHaveBeenCalledWith(expect.objectContaining({ trustProxy: false }));
    expect(req.headers["x-forwarded-for"]).toBeUndefined();
    expect(req.headers["x-9r-request-proof"]).toBe(process.env.NINE_ROUTER_REQUEST_PROOF);
    expect(req.headers["x-9r-request-proof"]).not.toBe("attacker-proof");
    expect(req.headers["x-9r-request-proof"]).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(downstream).toHaveBeenCalledWith(req, {});
  });
});
