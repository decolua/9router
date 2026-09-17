import { it, expect } from "vitest";
import {
  formatX509Certificate,
  isSamlConfigured,
  generateSamlMetadata,
  pickSamlEmail,
  pickSamlDisplayName,
} from "../../src/lib/auth/saml.js";

it("formatX509Certificate normalizes Base64 strings into PEM blocks", () => {
  const rawBase64 = "MIIC1234567890123456789012345678901234567890123456789012345678901234567890";
  const formatted = formatX509Certificate(rawBase64);
  expect(formatted).toMatch(/-----BEGIN CERTIFICATE-----/);
  expect(formatted).toMatch(/-----END CERTIFICATE-----/);
  expect(formatX509Certificate("")).toBe("");
});

it("isSamlConfigured checks required fields", () => {
  expect(isSamlConfigured({ samlEntryPoint: "https://idp.com/sso", samlCert: "cert" })).toBe(true);
  expect(isSamlConfigured({ samlEntryPoint: "https://idp.com/sso" })).toBe(false);
  expect(isSamlConfigured({})).toBe(false);
});

it("generateSamlMetadata produces valid SP XML", () => {
  const settings = {
    samlEntryPoint: "https://idp.example.com/sso",
    samlIssuer: "urn:9router:sp",
    samlCert: "MIIC123456789012345678901234567890123456789012345678901234567890",
  };
  const xml = generateSamlMetadata("https://localhost:20127", settings);
  expect(xml).toMatch(/entityID="urn:9router:sp"/);
  expect(xml).toMatch(/Location="https:\/\/localhost:20127\/api\/auth\/saml\/acs"/);
});

it("Claims Extraction pickSamlEmail & pickSamlDisplayName", () => {
  const profile = { email: "test@example.com", name: "Test User" };
  expect(pickSamlEmail(profile, {})).toBe("test@example.com");
  expect(pickSamlDisplayName(profile, {})).toBe("Test User");
});
