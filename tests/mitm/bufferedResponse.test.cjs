const test = require("node:test");
const assert = require("node:assert/strict");
const { PassThrough } = require("node:stream");
const { relayBufferedResponse } = require("../../src/mitm/bufferedResponse");

function response() {
  return { headersSent: false, writableEnded: false, writes: 0,
    writeHead(status, headers) { this.status = status; this.headers = headers; this.headersSent = true; this.writes++; },
    end(body) { this.body = Buffer.from(body); this.writableEnded = true; } };
}

test("buffers a management response before applying the transform and preserves observer bytes", async () => {
  const upstream = new PassThrough(); const res = response(); let observed;
  const pending = relayBufferedResponse(upstream, res, { status: 200, headers: { "content-length": "2" },
    onResponse(raw, headers, status) { observed = { raw: raw.toString(), status }; },
    transform(raw) { return { body: Buffer.from('{"byok":true}'), headers: { "content-length": "13" } }; } });
  upstream.write("{"); assert.equal(res.headersSent, false); upstream.end("}"); await pending;
  assert.deepEqual(observed, { raw: "{}", status: 200 }); assert.equal(res.body.toString(), '{"byok":true}');
  assert.equal(res.headers["content-length"], "13"); assert.equal(res.writes, 1);
});

test("an unchanged response keeps its original bytes and headers", async () => {
  const upstream = new PassThrough(); const res = response(); const headers = { "content-encoding": "gzip" };
  const raw = Buffer.from([0, 1, 2, 3]);
  const pending = relayBufferedResponse(upstream, res, { status: 403, headers,
    transform(body, originalHeaders) { return { body, headers: originalHeaders }; } });
  upstream.end(raw); await pending;
  assert.equal(res.status, 403); assert.deepEqual(res.body, raw); assert.deepEqual(res.headers, headers);
});

test("oversized or interrupted responses fail without leaking their bodies", async () => {
  for (const mode of ["oversized", "error"]) {
    const upstream = new PassThrough(); const res = response(); let transformed = false;
    const pending = relayBufferedResponse(upstream, res, { status: 200, headers: {}, maxBytes: 4,
      transform() { transformed = true; throw new Error("must not run"); } });
    if (mode === "oversized") upstream.end("sensitive upstream response"); else upstream.destroy(new Error("sensitive upstream error"));
    await pending; assert.equal(res.status, 502); assert.equal(transformed, false);
    assert.equal(res.body.toString().includes("sensitive"), false); assert.equal(res.writes, 1);
  }
});

test("early close and a stalled management response both finish with a bounded error", async () => {
  for (const mode of ["close", "timeout"]) {
    const upstream = new PassThrough(); const res = response();
    const pending = relayBufferedResponse(upstream, res, { status: 200, headers: {}, timeoutMs: 10,
      transform() { throw new Error("must not run"); } });
    if (mode === "close") upstream.destroy();
    await pending;
    assert.equal(res.status, 502); assert.equal(res.writes, 1);
  }
});
