const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");
const config = require("../../src/mitm/config");
const byok = require("../../src/mitm/antigravityByok");

function makeServer(bindHost) {
  let handler, forwarded = [], dumps = 0, killed = 0, requestTimeout;
  const policy = { enabled: true, mappings: { slot: { target: "provider/model", label: "Model" } }, auxiliaryMappings: {} };
  const emitter = new EventEmitter();
  emitter.listen = (_port, _host, ready) => ready();
  emitter.close = callback => callback();
  const modules = {
    https: { createServer: (_options, callback) => { handler = callback; return emitter; } },
    http2: {}, tls: {}, fs: { ...fs, existsSync: () => true, readFileSync: () => Buffer.from("fake-cert") },
    dns: {}, "child_process": { execSync: () => { killed++; throw Error("unexpected kill"); } },
    "./logger": { log() {}, err() {}, dumpRequest() { dumps++; }, createResponseDumper() { dumps++; }, clearDumpDir() {} },
    "./config": { ...config, IS_DEV: true },
    "./paths": { DATA_DIR: "fake", MITM_DIR: "fake" },
    "./cert/generate": { generateCert() {}, getCertForDomain() {} },
    "./dbReader": { getMitmAlias() { return null; } },
    "./antigravityIdeVersion": { applyAntigravityIdeVersionOverride: body => ({ bodyBuffer: body }) },
    "./antigravityAudit": { createAntigravityObserver: () => null },
    "./antigravityByok": { ...byok, loadPolicy: () => policy },
    "./bufferedResponse": { relayBufferedResponse() { throw Error("unexpected network"); } },
    "./handlers/antigravity": { intercept: (_req, res, _body, target, options) => { forwarded.push({ target, options }); res.writeHead(200, {}); res.end("ok"); } },
    "./handlers/copilot": {}, "./handlers/kiro": {}, "./handlers/cursor": {},
    "./dns/dnsConfig": { removeAllDNSEntriesSync() {} },
  };
  const source = fs.readFileSync(path.join(__dirname, "../../src/mitm/server.js"), "utf8");
  const fakeProcess = { env: { NODE_ENV: "development", ...(bindHost ? { MITM_BIND_HOST: bindHost } : {}) }, platform: "win32", pid: 1, on() {}, exit() { throw Error("unexpected exit"); } };
  const recordTimeout = (callback, ms) => { if (ms === 30000) requestTimeout = callback; return setTimeout(callback, ms); };
  vm.runInNewContext(source, { require: id => Object.hasOwn(modules, id) ? modules[id] : require(id), process: fakeProcess, Buffer, console, setTimeout: recordTimeout, clearTimeout });
  async function request(host, url, body, headers = {}, event = "end") {
    const req = new EventEmitter();
    req.headers = { host, ...headers }; req.url = url;
    req.resume = () => { req.resumed = true; };
    const res = { headersSent: false, writableEnded: false, writeHead(status) { this.status = status; this.headersSent = true; }, end(value) { this.body = value; this.writableEnded = true; } };
    const pending = handler(req, res);
    if (event === "timeout") requestTimeout();
    else if (event === "aborted") req.emit("aborted");
    else if (event === "error") req.emit("error", Error("synthetic read failure"));
    else if (event === "close") req.emit("close");
    else if (event === "oversize") req.emit("data", Buffer.alloc(32 * 1024 * 1024 + 1));
    else { req.emit("data", Buffer.from(JSON.stringify(body))); req.emit("end"); }
    await pending;
    if (["timeout", "aborted", "oversize", "error", "close"].includes(event)) {
      // Real IncomingMessage can emit an error following abort.
      req.emit("error", Error("synthetic disconnect"));
      req.emit("close");
    }
    res.request = req;
    return res;
  }
  return { request, forwarded, get dumps() { return dumps; }, get killed() { return killed; } };
}

test("BYOK routes only explicit model mappings and never passes unknown generation to Google", async () => {
  const server = makeServer();
  const health = await server.request("localhost", "/_mitm_health", {});
  assert.deepEqual(JSON.parse(health.body), { ok: true, pid: 1, byok: true, byokPolicyVersion: 1, feature: "antigravity-byok-v1" });
  assert.equal((await server.request("cloudcode-pa.googleapis.com", "/v1internal:streamGenerateContent", { model: "unknown" })).status, 403);
  assert.equal((await server.request("cloudcode-pa.googleapis.com", "/v1internal:unknownRpc", {})).status, 403);
  assert.equal((await server.request("cloudcode-pa.googleapis.com.evil.test", "/v1internal:streamGenerateContent", { model: "slot" })).status, 421);
  assert.equal((await server.request("cloudcode-pa.googleapis.com", "/v1internal:streamGenerateContent", { model: "slot" }, { "x-request-source": "local" })).status, 200);
  assert.equal(server.forwarded.length, 1);
  assert.equal(server.forwarded[0].target, "provider/model");
  assert.equal(server.forwarded[0].options.disableRawDump, true);
  assert.equal(server.dumps, 0, "BYOK development mode must not dump sensitive requests");
  assert.equal(server.killed, 0, "BYOK mode must never kill the process using port 443");
});

test("BYOK rejects non-loopback binds before accepting connections", () => {
  for (const host of ["0.0.0.0", "::", "192.0.2.10", "localhost"]) {
    assert.throws(() => makeServer(host), /must bind to a loopback address/);
  }
  assert.doesNotThrow(() => makeServer("127.0.0.1"));
  assert.doesNotThrow(() => makeServer("::1"));
});

test("BYOK body limits, aborted streams, and deadlines fail without routing", async () => {
  const server = makeServer();
  const endpoint = "/v1internal:streamGenerateContent";
  for (const [event, expected] of [["oversize", 413], ["timeout", 408], ["aborted", 400], ["error", 400], ["close", 400]]) {
    const res = await server.request("cloudcode-pa.googleapis.com", endpoint, {}, {}, event);
    assert.equal(res.status, expected);
    assert.equal(res.request.resumed, true);
    assert.equal(res.request.listenerCount("data"), 0);
    assert.equal(res.request.listenerCount("error"), 0);
    assert.equal(res.request.listenerCount("close"), 0);
  }
  const unknown = await server.request("evil.example", endpoint, {});
  assert.equal(unknown.status, 421);
  assert.equal(unknown.request.listenerCount("data"), 0);
  assert.equal(server.forwarded.length, 0);
});
