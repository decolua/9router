import { describe, it, expect } from "vitest";
import {
  formatX509Certificate,
  isSamlConfigured,
  generateSamlMetadata,
  pickSamlEmail,
  pickSamlDisplayName,
  validateSamlResponse,
} from "../../src/lib/auth/saml.js";
import { mergeWithDefaults, normalizeCustomPatterns } from "../../src/lib/db/repos/settingsRepo.js";

describe("SAML 2.0 Auth Engine Utilities", () => {
  describe("formatX509Certificate", () => {
    it("formats raw Base64 string into standard 64-column PEM block", () => {
      const rawBase64 = "MIIC1234567890123456789012345678901234567890123456789012345678901234567890";
      const formatted = formatX509Certificate(rawBase64);
      expect(formatted).toContain("-----BEGIN CERTIFICATE-----");
      expect(formatted).toContain("-----END CERTIFICATE-----");
      expect(formatted).toContain("MIIC123456789012345678901234567890123456789012345678901234567890");
      expect(formatted).toContain("\n1234567890\n");
    });

    it("cleans existing PEM header/footer and extra whitespace", () => {
      const rawPem = `
        -----BEGIN CERTIFICATE-----
        MIIC123456789012345678901234567890123456789012345678901234567890
        1234567890
        -----END CERTIFICATE-----
      `;
      const formatted = formatX509Certificate(rawPem);
      expect(formatted).toContain("-----BEGIN CERTIFICATE-----");
      expect(formatted.match(/BEGIN CERTIFICATE/g)?.length).toBe(1);
    });

    it("returns empty string for null, undefined, or invalid inputs", () => {
      expect(formatX509Certificate(null)).toBe("");
      expect(formatX509Certificate(undefined)).toBe("");
      expect(formatX509Certificate("   ")).toBe("");
    });
  });

  describe("isSamlConfigured", () => {
    it("returns true when entryPoint and cert are non-empty", () => {
      expect(
        isSamlConfigured({
          samlEntryPoint: "https://idp.example.com/sso",
          samlCert: "dummy-cert",
        })
      ).toBe(true);
    });

    it("returns false if entryPoint or cert is missing", () => {
      expect(isSamlConfigured({ samlEntryPoint: "https://idp.example.com/sso" })).toBe(false);
      expect(isSamlConfigured({ samlCert: "dummy-cert" })).toBe(false);
      expect(isSamlConfigured({})).toBe(false);
    });
  });

  describe("generateSamlMetadata", () => {
    it("generates valid SP XML metadata with Entity ID and ACS binding", () => {
      const settings = {
        samlEntryPoint: "https://idp.example.com/sso",
        samlIssuer: "urn:9router:sp",
        samlCert: "MIIC123456789012345678901234567890123456789012345678901234567890",
      };
      const xml = generateSamlMetadata("https://localhost:20127", settings);
      expect(xml).toContain('entityID="urn:9router:sp"');
      expect(xml).toContain('Location="https://localhost:20127/api/auth/saml/acs"');
      expect(xml).toContain('WantAssertionsSigned="true"');
    });
  });

  describe("InResponseTo Replay Validation", () => {
    it("throws error when expectedRequestId is supplied but InResponseTo is missing", async () => {
      const settings = { samlCert: "dummy-cert" };
      const rawXml = Buffer.from('<Response ID="123"></Response>').toString("base64");
      await expect(
        validateSamlResponse(null, { SAMLResponse: rawXml }, "req-123", settings)
      ).rejects.toThrow(/InResponseTo mismatch/);
    });

    it("throws error when expectedRequestId is supplied but InResponseTo does not match", async () => {
      const settings = { samlCert: "dummy-cert" };
      const rawXml = Buffer.from('<Response InResponseTo="wrong-id"></Response>').toString("base64");
      await expect(
        validateSamlResponse(null, { SAMLResponse: rawXml }, "req-123", settings)
      ).rejects.toThrow(/InResponseTo mismatch/);
    });

    it("throws error if samlCert is not configured", async () => {
      const rawXml = Buffer.from('<Response ID="123"></Response>').toString("base64");
      await expect(
        validateSamlResponse(null, { SAMLResponse: rawXml }, "req-123", {})
      ).rejects.toThrow(/Certificate/);
    });
  });

  describe("Claims Extraction", () => {
    const mockProfile = {
      email: "user@example.com",
      displayName: "Jane Doe",
      "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress": ["custom@example.com"],
      customEmail: "custom-email@example.com",
      customName: "Custom User",
    };

    it("pickSamlEmail extracts custom attribute or common claims", () => {
      expect(pickSamlEmail(mockProfile, {})).toBe("user@example.com");
      expect(
        pickSamlEmail(mockProfile, { samlAttributeEmail: "customEmail" })
      ).toBe("custom-email@example.com");
      expect(
        pickSamlEmail(
          { "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress": ["custom@example.com"] },
          {}
        )
      ).toBe("custom@example.com");
    });

    it("pickSamlDisplayName extracts custom attribute, common names, or falls back to email", () => {
      expect(pickSamlDisplayName(mockProfile, {})).toBe("Jane Doe");
      expect(
        pickSamlDisplayName(mockProfile, { samlAttributeName: "customName" })
      ).toBe("Custom User");
      expect(
        pickSamlDisplayName({ email: "user@example.com" }, {})
      ).toBe("user@example.com");
      expect(
        pickSamlDisplayName({ givenName: "Alice", surname: "Smith" }, {})
      ).toBe("Alice Smith");
    });
  });

  describe("Settings Repository Defaults", () => {
    it("mergeWithDefaults safely populates SAML defaults for existing installations", () => {
      const merged = mergeWithDefaults({ authMode: "password" });
      expect(merged.ssoType).toBe("oidc");
      expect(merged.samlIssuer).toBe("urn:9router:sp");
      expect(merged.samlLoginLabel).toBe("Sign in with SAML SSO");
      expect(merged.samlAttributeEmail).toBe("email");
      expect(merged.samlAttributeName).toBe("name");
    });

    it("mergeWithDefaults safely populates DLP defaults for existing installations", () => {
      const merged = mergeWithDefaults({});
      expect(merged.dlpEnabled).toBe(false);
      expect(merged.dlpConsent).toBe(false);
      expect(merged.dlpMode).toBe("pseudo");
      expect(merged.dlpTypes).toEqual(["email", "phone", "cpf", "cnpj", "creditCard", "ip", "apiKey"]);
      expect(merged.dlpCustomPatterns).toEqual([]);
      expect(merged.dlpMaskResponses).toBe(true);
    });

    it("mergeWithDefaults assigns UUIDs to legacy custom patterns without id", () => {
      const merged = mergeWithDefaults({
        dlpCustomPatterns: [
          { name: "codigo CC", pattern: "CC-\\d{4}", type: "regex", enabled: false },
          { name: "chave vault", pattern: "vault-*-secret", type: "wildcard", enabled: false },
        ],
      });
      const ids = merged.dlpCustomPatterns.map((c) => c.id);
      expect(ids).toHaveLength(2);
      for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      expect(new Set(ids).size).toBe(2);
      // conteúdo preservado
      expect(merged.dlpCustomPatterns[0].pattern).toBe("CC-\\d{4}");
      expect(merged.dlpCustomPatterns[1].name).toBe("chave vault");
    });

    it("mergeWithDefaults resolves legacy ids colliding with the frontend fallback", () => {
      // Cenário real do bug: um pattern sem id (fallback `regex-CC-\d{4}-0` no
      // frontend) + um segundo idêntico persistido com esse mesmo id derivado.
      // O pattern sem id ganha UUID (fim da colisão); o id legado único é
      // preservado — ambos os keys ficam distintos.
      const merged = mergeWithDefaults({
        dlpCustomPatterns: [
          { name: "codigo CC", pattern: "CC-\\d{4}", type: "regex", enabled: false },
          { name: "codigo CC", pattern: "CC-\\d{4}", type: "regex", enabled: false, id: "regex-CC-\\d{4}-0" },
        ],
      });
      const cps = merged.dlpCustomPatterns;
      expect(cps).toHaveLength(2);
      const ids = cps.map((c) => c.id);
      expect(new Set(ids).size).toBe(2);
      // id legado único preservado…
      expect(cps.some((c) => c.id === "regex-CC-\\d{4}-0")).toBe(true);
      // …e o pattern sem id recebe um UUID (deixa de colidir com o id acima).
      const withUuid = cps.find((c) => c.id !== "regex-CC-\\d{4}-0");
      expect(withUuid.name).toBe("codigo CC");
      expect(withUuid.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i);
    });

    it("normalizeCustomPatterns preserves unique valid ids and keeps the shape", () => {
      const cp = { name: "ok", pattern: "x+", type: "regex", id: "11111111-2222-4333-8444-555555555555" };
      const out = normalizeCustomPatterns([cp, { name: "sem id", pattern: "y+", type: "wildcard" }]);
      expect(out[0].id).toBe(cp.id);
      expect(out[1].id).toMatch(/^[0-9a-f-]{36}$/i);
      expect(out[1].pattern).toBe("y+");
      expect(normalizeCustomPatterns(undefined)).toEqual([]);
      expect(normalizeCustomPatterns(null)).toEqual([]);
      expect(normalizeCustomPatterns("nope")).toEqual([]);
    });

    it("normalizeCustomPatterns is idempotent", () => {
      const once = normalizeCustomPatterns([
        { name: "a", pattern: "x+", type: "regex" },
        { name: "a", pattern: "x+", type: "regex", id: "legacy-dup" },
      ]);
      const twice = normalizeCustomPatterns(once);
      expect(twice.map((c) => c.id)).toEqual(once.map((c) => c.id));
    });
  });
});
