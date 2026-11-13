const test = require("node:test");
const assert = require("node:assert/strict");
const { getToolForHost } = require("../../src/mitm/config");

test("Antigravity hosts are recognized independent of DNS casing, port and trailing dot", () => {
  for (const host of ["cloudcode-pa.googleapis.com", "Cloudcode-pa.Googleapis.com:443", "DAILY-CLOUDCODE-PA.GOOGLEAPIS.COM.", "daily-cloudcode-pa.googleapis.com.:443"]) {
    assert.equal(getToolForHost(host), "antigravity");
  }
  for (const host of ["cloudcode-pa.googleapis.com.evil.test", "googleapis.com", "", undefined]) {
    assert.equal(getToolForHost(host), null);
  }
});
