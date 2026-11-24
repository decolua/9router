const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function makeHandler(failure = false) {
  let forwarded, dumps = 0, errors = [];
  const modules = {
    "../logger": { err: text => errors.push(text), createResponseDumper: () => { dumps++; } },
    "../config": { IS_DEV: true },
    "./base": {
      fetchRouter: async (body, endpoint, headers) => { forwarded = { body, endpoint, headers }; if (failure) throw Error("fake-secret-from-transport"); return { status: 200 }; },
      pipeSSE: async (_upstream, res) => { res.writeHead(200); res.end("ok"); },
    },
  };
  const code = fs.readFileSync(path.join(__dirname, "../../src/mitm/handlers/antigravity.js"), "utf8");
  const module = { exports: {} };
  vm.runInNewContext(code, { module, require: id => modules[id], Buffer, JSON, process: { env: {} } });
  return { intercept: module.exports.intercept, get forwarded() { return forwarded; }, get dumps() { return dumps; }, errors };
}

test("handler sends the registered target even when the client body has no model", async () => {
  const h = makeHandler();
  const res = { writeHead(status) { this.status = status; }, end() {} };
  await h.intercept({ url: "/v1internal:streamGenerateContent", headers: { authorization: "fake-secret", "x-goog-api-key": "fake-secret", cookie: "fake-secret", "user-agent": "IDE" } }, res, Buffer.from('{"request":{"contents":[]}}'), "responses-provider/vendor/model", { disableRawDump: true });
  assert.equal(h.forwarded.body.model, "responses-provider/vendor/model");
  assert.equal(h.forwarded.endpoint, "/v1/chat/completions");
  assert.deepEqual(Object.entries(h.forwarded.headers), [["user-agent", "IDE"]]);
  assert.equal(h.dumps, 0);
});

test("BYOK transport errors do not report success or expose the error body", async () => {
  const h = makeHandler(true);
  const res = { writeHead(status) { this.status = status; }, end(body) { this.body = body; } };
  await h.intercept({ url: "/v1internal:streamGenerateContent", headers: {} }, res, Buffer.from("{}"), "provider/model", { disableRawDump: true });
  assert.equal(res.status, 502);
  assert.equal(res.body.includes("fake-secret"), false);
  assert.equal(h.errors.join(" ").includes("fake-secret"), false);
  assert.equal(h.dumps, 0);
});
