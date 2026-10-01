import test from "node:test";
import assert from "node:assert/strict";
import {
  formatX509Certificate,
  isSamlConfigured,
  generateSamlMetadata,
  pickSamlEmail,
  pickSamlDisplayName,
} from "../../src/lib/auth/saml.js";

test("formatX509Certificate normalizes Base64 strings into PEM blocks", () => {
  const rawBase64 = "MIIC1234567890123456789012345678901234567890123456789012345678901234567890";
  const formatted = formatX509Certificate(rawBase64);
  assert.match(formatted, /-----BEGIN CERTIFICATE-----/);
  assert.match(formatted, /-----END CERTIFICATE-----/);
  assert.equal(formatX509Certificate(""), "");
});

test("isSamlConfigured checks required fields", () => {
  assert.equal(isSamlConfigured({ samlEntryPoint: "https://idp.com/sso", samlCert: "cert" }), true);
  assert.equal(isSamlConfigured({ samlEntryPoint: "https://idp.com/sso" }), false);
  assert.equal(isSamlConfigured({}), false);
});

test("generateSamlMetadata produces valid SP XML", () => {
  const settings = {
    samlEntryPoint: "https://idp.example.com/sso",
    samlIssuer: "urn:9router:sp",
    samlCert: "MIIC123456789012345678901234567890123456789012345678901234567890",
  };
  const xml = generateSamlMetadata("https://localhost:20127", settings);
  assert.match(xml, /entityID="urn:9router:sp"/);
  assert.match(xml, /Location="https:\/\/localhost:20127\/api\/auth\/saml\/acs"/);
});

test("Claims Extraction pickSamlEmail & pickSamlDisplayName", () => {
  const profile = { email: "test@example.com", name: "Test User" };
  assert.equal(pickSamlEmail(profile, {}), "test@example.com");
  assert.equal(pickSamlDisplayName(profile, {}), "Test User");
});
