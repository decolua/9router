const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("Google upstream TLS verifies certificates for ALPN, HTTP/2, and HTTP/1", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../src/mitm/server.js"), "utf8");
  const functions = ["negotiateAlpn", "passthroughHttp2", "passthroughHttps"];
  for (const name of functions) {
    const start = source.indexOf(`async function ${name}(`);
    assert.notEqual(start, -1, `${name} must exist`);
    const next = source.indexOf("\nasync function ", start + 1);
    const section = source.slice(start, next === -1 ? undefined : next);
    assert.match(section, /rejectUnauthorized:\s*true/, `${name} must verify TLS certificates`);
    assert.match(section, /servername:\s*(?:host|targetHost)/, `${name} must verify the original hostname`);
    assert.doesNotMatch(section, /rejectUnauthorized:\s*false/);
  }
});
