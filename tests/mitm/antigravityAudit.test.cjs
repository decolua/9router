const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { createAntigravityObserver } = require("../../src/mitm/antigravityAudit.js");

const envName = "ANTIGRAVITY_BYOK_AUDIT_FILE";
const previous = process.env[envName];
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "9router-audit-test-"));
const file = path.join(temp, "audit.jsonl");
const request = (url = "/v1internal:fetchAvailableModels?token=fake-query-secret", host = "cloudcode-pa.googleapis.com") => ({
  url,
  headers: { host, authorization: "Bearer fake-authorization-secret", "x-api-key": "fake-api-key" },
});

after(() => {
  if (previous === undefined) delete process.env[envName];
  else process.env[envName] = previous;
  assert.ok(fs.realpathSync(temp).startsWith(path.join(fs.realpathSync(os.tmpdir()), "9router-audit-test-")));
  fs.rmSync(temp, { recursive: true, force: true });
});

test("audit is opt-in and limited to exact hosts and paths", () => {
  delete process.env[envName];
  assert.equal(createAntigravityObserver(request()), null);
  process.env[envName] = file;
  assert.equal(createAntigravityObserver(request("/v1internal:generateContent")), null);
  assert.equal(createAntigravityObserver(request("/v1internal:fetchAvailableModels", "googleapis.com.evil")), null);
  assert.equal(createAntigravityObserver(request("/v1internal:fetchAvailableModels/extra")), null);
  assert.equal(fs.existsSync(file), false);
});

test("logs safe metadata only, including compressed responses", () => {
  process.env[envName] = file;
  const response = {
    models: { "person@example.test": { quotaInfo: { remainingFraction: 0.2, disabled: false }, prompt: "fake-prompt-secret" } },
    availableCredits: [{ creditType: "GOOGLE_ONE_AI", creditAmount: "123", minimumCreditAmountForUsage: 4 }, { creditType: "fake-credit-secret", creditAmount: "fake-secret" }],
    "fake-secret-key": "fake-secret-value",
    authorization: "fake-authorization-secret",
  };
  for (const [encoding, encode] of [["identity", b => b], ["gzip", zlib.gzipSync], ["br", zlib.brotliCompressSync], ["deflate", zlib.deflateSync]]) {
    const observer = createAntigravityObserver(request());
    observer(encode(Buffer.from(JSON.stringify(response))), { "content-encoding": encoding }, 200);
  }
  const text = fs.readFileSync(file, "utf8");
  for (const forbidden of ["fake-", "person@example.test", "authorization", "prompt", "token="]) assert.equal(text.includes(forbidden), false);
  const events = text.trim().split("\n").map(JSON.parse);
  assert.equal(events.length, 4);
  for (const event of events) {
    assert.equal(event.host, "cloudcode-pa.googleapis.com");
    assert.equal(event.path, "/v1internal:fetchAvailableModels");
    assert.equal(event.status, 200);
    assert.deepEqual(event.fields, [
      { path: "models[].quotaInfo.remainingFraction", value: 0.2 },
      { path: "models[].quotaInfo.disabled", value: false },
      { path: "availableCredits[].creditType", value: "GOOGLE_ONE_AI" },
      { path: "availableCredits[].creditAmount", value: "123" },
      { path: "availableCredits[].minimumCreditAmountForUsage", value: 4 },
    ]);
  }
});

test("parse failures and oversized responses record no content", () => {
  process.env[envName] = file;
  const observer = createAntigravityObserver(request("/v1internal:retrieveUserQuotaSummary", "daily-cloudcode-pa.googleapis.com"));
  observer(Buffer.from("fake-invalid-secret"), {}, 500);
  observer(zlib.gzipSync(Buffer.alloc(2 * 1024 * 1024 + 1)), { "content-encoding": "gzip" }, 200);
  const events = fs.readFileSync(file, "utf8").trim().split("\n").map(JSON.parse);
  for (const event of events.slice(-2)) assert.deepEqual(event, {
    host: "daily-cloudcode-pa.googleapis.com", path: "/v1internal:retrieveUserQuotaSummary", status: event.status, parseError: true,
  });
});

test("write failure is non-fatal", () => {
  process.env[envName] = path.join(temp, "missing", "audit.jsonl");
  assert.doesNotThrow(() => createAntigravityObserver(request("/v1internal:loadCodeAssist"))(Buffer.from("{}"), {}, 200));
});
