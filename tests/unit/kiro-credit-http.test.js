import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import { runInNewContext } from "node:vm";
import http from "node:http";

const require = createRequire(import.meta.url);
const symbol = Symbol.for("9router.responseDelivery");
const originalStorage = globalThis[symbol];
afterEach(() => { globalThis[symbol] = originalStorage; });

function wrappedHttp() {
  // Exercise the real HTTP wrapper with real sockets while excluding its unrelated
  // background OAuth refresh bootstrap (no credentials or provider network calls).
  const facade = { createServer(...args) {
    const server = http.createServer(...args);
    server.once = function (event, callback) {
      return event === "listening" ? this : EventEmitter.prototype.once.call(this, event, callback);
    };
    return server;
  } };
  const moduleContext = {};
  runInNewContext(readFileSync(new URL("../../custom-server.js", import.meta.url), "utf8"), {
    require: name => name === "http" ? facade : require(name), module: moduleContext,
    __dirname: "/tmp/kiro-http-test", globalThis, process: { env: {} }, console
  });
  return facade;
}

describe("HTTP delivery receipts", () => {
  it.each(["finish", "client disconnect", "write error", "HTTP failure"])("settles once on %s", async mode => {
    const receipts = [];
    let resolveReceipt;
    const observed = new Promise(resolve => { resolveReceipt = resolve; });
    const server = wrappedHttp().createServer((req, res) => {
      const delivery = globalThis[symbol].getStore();
      delivery.callbacks.add(success => { receipts.push(success); resolveReceipt(); });
      if (mode === "HTTP failure") res.statusCode = 502;
      if (mode === "write error") res.destroy(new Error("fixture write failure"));
      else if (mode === "client disconnect") res.write("partial");
      else res.end("complete");
    });
    server.once = EventEmitter.prototype.once;
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      await new Promise(resolve => {
        const request = http.get(`http://127.0.0.1:${server.address().port}`, response => {
          response.on("data", () => { if (mode === "client disconnect") request.destroy(); });
          response.on("end", resolve);
          response.on("close", resolve);
        });
        request.on("error", resolve);
      });
      await observed;
      expect(receipts).toEqual([mode === "finish"]);
    } finally {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  });
});
