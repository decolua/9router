const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createManager, publicStatus, selectKey } = require("../Manage-Byok.cjs");
const { validate } = require("../Validate-Profile.cjs");

test("restricted and inactive keys never become the bridge credential", () => {
  const limited = { key: "synthetic-limited", isActive: true, access: { restricted: true } };
  const inactive = { key: "synthetic-inactive", isActive: false, access: { restricted: false } };
  const suitable = { key: "synthetic-unrestricted", access: { restricted: false } };
  assert.equal(selectKey([limited, inactive, suitable]), suitable);
  assert.equal(selectKey([limited, inactive]), undefined);
});

test("management summaries cannot disclose provider or local authentication material", () => {
  const status = publicStatus({ running: true, pid: 123, isAdmin: true, certTrusted: true,
    apiKey: "synthetic-sensitive", password: "synthetic-sensitive", hasCachedPassword: true,
    dnsStatus: { antigravity: true, copilot: false, cursor: false, kiro: false } });
  assert.deepEqual(Object.keys(status).sort(), ["certTrusted", "isAdmin", "otherBridgesActive", "pid", "running", "success"]);
  assert.equal(JSON.stringify(status).includes("synthetic-sensitive"), false);
});

test("other active bridges remain visible to the caller's fail-closed check", () => {
  assert.equal(publicStatus({ dnsStatus: { kiro: true } }).otherBridgesActive, true);
  assert.equal(publicStatus({ dnsStatus: { antigravity: true } }).otherBridgesActive, false);
});

test("an untrusted CA fails before any management mutation or key lookup", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "byok-manager-fixture-"));
  fs.mkdirSync(path.join(dataDir, "auth"));
  fs.writeFileSync(path.join(dataDir, "machine-id"), "synthetic-machine");
  fs.writeFileSync(path.join(dataDir, "auth", "cli-secret"), "synthetic-local-secret");
  const calls = [];
  const manager = createManager({ dataDir, gatewayPort: 20128 }, { fetchImpl: async (url, options) => {
    calls.push({ url, method: options.method });
    return { ok: true, json: async () => ({ running: true, certTrusted: false, dnsStatus: {} }) };
  } });
  await assert.rejects(manager.start(), /CERTIFICATE_NOT_TRUSTED/);
  assert.deepEqual(calls.map(call => call.method), ["GET"]);
});

test("the shared installed policy loader rejects labels and auxiliary routes before controls run", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "byok-validator-fixture-"));
  const profile = path.join(directory, "profile.json");
  const installedValidator = path.resolve(__dirname, "../../../src/mitm/antigravityByok.js");
  const valid = { enabled: true, mappings: { "user-slot": { target: "user-provider/example-model", label: "My model" } } };
  fs.writeFileSync(profile, JSON.stringify(valid));
  assert.equal(validate(profile, installedValidator).success, true);
  for (const invalid of [
    { ...valid, mappings: { "user-slot": { target: "user-provider/example-model", label: "bad\nlabel" } } },
    { ...valid, auxiliaryMappings: { "user-aux": "not a target" } },
    { ...valid, mappings: { "invalid slot": { target: "user-provider/example-model", label: "My model" } } },
  ]) {
    fs.writeFileSync(profile, JSON.stringify(invalid));
    assert.deepEqual(validate(profile, installedValidator), { success: false, error: "INVALID_ROUTING_PROFILE" });
  }
  assert.equal(validate(profile, path.join(directory, "missing-loader.js")).success, false);
});
