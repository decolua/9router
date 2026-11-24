const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { loadPolicy, resolveTarget, rewriteManagementResponse } = require("../../src/mitm/antigravityByok");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "byok-policy-"));
const file = path.join(dir, "policy.json");
after(() => {
  assert.ok(fs.realpathSync(dir).startsWith(path.join(fs.realpathSync(os.tmpdir()), "byok-policy-")));
  fs.rmSync(dir, { recursive: true, force: true });
});
function policy(data) { fs.writeFileSync(file, JSON.stringify(data)); return loadPolicy(file); }
const config = () => ({ enabled: true, mappings: {
  slotA: { target: "my-provider/model-a", label: "Model A (custom provider)" },
  slotB: { target: "my-responses/vendor/model-b", label: "Model B (responses)" },
}, auxiliaryMappings: { helper: "my-provider/model-a" } });
const modelPath = "/v1internal:fetchAvailableModels";
const body = value => Buffer.from(JSON.stringify(value));

test("policy is opt-in, exact, provider-agnostic and fail-closed on malformed config", () => {
  assert.equal(loadPolicy(""), null);
  assert.equal(policy({ enabled: false }), null);
  const p = policy(config());
  assert.equal(resolveTarget(p, "models/slotA"), "my-provider/model-a");
  assert.equal(resolveTarget(p, "slotB"), "my-responses/vendor/model-b");
  assert.equal(resolveTarget(p, "helper"), "my-provider/model-a");
  assert.equal(resolveTarget(p, "slotA-extra"), null);
  assert.equal(resolveTarget(p, "constructor"), null);
  for (const bad of [
    {}, { enabled: true, mappings: {} },
    { enabled: true, mappings: { slotA: "provider/model" } },
    { enabled: true, mappings: { slotA: { target: "provider/model", label: "" } } },
    { enabled: true, mappings: { slotA: { target: "https://x/y", label: "X" } } },
    { enabled: true, mappings: { slotA: { target: "provider/*", label: "X" } } },
    { enabled: true, mappings: { slotA: { target: "provider/model", label: "X\nY" } } },
    { ...config(), auxiliaryMappings: { slotA: "provider/model" } },
    { ...config(), mappedModelsOnly: true },
  ]) assert.throws(() => policy(bad));
});

test("catalog relabels only eligible exact mappings and preserves all helpers and credits", () => {
  const p = policy(config());
  const input = { accountMetadata: { keep: true }, models: {
    native: { displayName: "Native", quotaInfo: { remainingFraction: 0.5 } },
    slotA: { displayName: "Old A", quotaInfo: { resetTime: "kept" }, extra: "kept" },
    slotB: { displayName: "Old B", disabled: true, quotaInfo: { remainingFraction: 0 } },
    helper: { displayName: "Helper", quotaInfo: { remainingFraction: 0.25 }, internal: true },
  } };
  const result = rewriteManagementResponse(modelPath, 200, {}, body(input), p);
  assert.equal(result.changed, true);
  const data = JSON.parse(result.body);
  assert.deepEqual(Object.keys(data.models), Object.keys(input.models));
  assert.deepEqual(data.models.helper, input.models.helper);
  assert.deepEqual(data.models.slotB, input.models.slotB);
  assert.equal(data.models.native.disabled, true);
  assert.equal(data.models.slotA.displayName, "Model A (custom provider)");
  assert.equal(data.models.slotA.quotaInfo.remainingFraction, 1);
  assert.equal(data.models.slotA.quotaInfo.resetTime, "kept");
  assert.deepEqual(data.accountMetadata, input.accountMetadata);
  const credit = body({ paidTier: { availableCredits: [{ creditAmount: "20", minimumCreditAmountForUsage: "50" }] } });
  const unchanged = rewriteManagementResponse("/v1internal:loadCodeAssist", 200, {}, credit, p);
  assert.strictEqual(unchanged.body, credit);
  assert.equal(unchanged.changed, false);
});

test("malformed or unknown schemas and error statuses preserve original bytes", () => {
  const p = policy(config()), headers = {};
  for (const [status, input] of [[200, body({ models: [] })], [403, body({ models: { slotA: { quotaInfo: {} } } })], [200, Buffer.from("not-json")], [200, body({ models: { slotA: { disabled: true, quotaInfo: {} } } })]]) {
    const output = rewriteManagementResponse(modelPath, status, headers, input, p);
    assert.equal(output.changed, false);
    assert.strictEqual(output.body, input);
    assert.strictEqual(output.headers, headers);
  }
});

test("compressed responses return valid identity bodies without stale framing", () => {
  const p = policy(config());
  for (const [encoding, compress] of [["gzip", zlib.gzipSync], ["br", zlib.brotliCompressSync], ["deflate", zlib.deflateSync]]) {
    const result = rewriteManagementResponse(modelPath, 200, { "Content-Encoding": encoding, ETag: "stale", "Content-MD5": "stale", "Transfer-Encoding": "chunked" }, compress(body({ models: { slotA: { quotaInfo: {} } } })), p);
    assert.equal(result.changed, true);
    assert.deepEqual(result.headers, { "content-length": String(result.body.length) });
    assert.equal(JSON.parse(result.body).models.slotA.quotaInfo.remainingFraction, 1);
  }
});
