// F29 / T1.3-F-2 (HIGH): SAML assertion replay + spoofable Destination.
// (a) validateInResponseTo was "never" and the manual InResponseTo match only ran when
//     the saml_state cookie was present — so a captured signed assertion could be
//     REPLAYED to /api/auth/saml/acs with no cookie at all and mint a dashboard JWT.
//     Fix: the saml_state cookie is the state store; when it is missing the login must
//     FAIL (fail closed, SP-initiated only), and node-saml itself must enforce
//     InResponseTo (no "never").
// (b) getSamlBaseUrl honored x-forwarded-host, an attacker-controlled header, and that
//     origin is what the ACS URL (the Destination the response is audited against) is
//     built from. custom-server.js now strips x-forwarded-host unconditionally (F21'),
//     but saml.js must not read it either (dev / unwrapped next start still see it) —
//     the destination must come from admin config (settings.baseUrl / BASE_URL env)
//     falling back only to the Host header the server itself received, never XFH.
//     Verified-by-reading note: @node-saml/node-saml 5.1.0 validates NO Destination and
//     NO SubjectConfirmationData/@Recipient attribute at all — the audit is this module's
//     responsibility, so it is asserted here against the config-derived ACS URL.
//
// Fixtures are unsigned minimal SAML Responses: every hardened check below runs BEFORE
// signature validation, so the tests distinguish gate outcomes by error class (state /
// InResponseTo / destination / recipient) vs. reaching the library's signature stage.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createSamlInstance,
  getSamlBaseUrl,
  validateSamlResponse,
} from "../../src/lib/auth/saml.js";

const SETTINGS = {
  samlEntryPoint: "https://idp.example.com/sso",
  samlIssuer: "urn:9router:sp",
  samlCert: "MIIDummyCertPayload0123456789abcdef0123456789abcdef0123456789abcdef",
};

function makeRequest(url, headers = {}) {
  const map = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { url, headers: { get: (name) => map.get(String(name).toLowerCase()) ?? null } };
}

function responseXml({ inResponseTo, destination, withRecipient } = {}) {
  const attrs = [
    'xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"',
    'xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"',
    'ID="_resp-1"',
    'Version="2.0"',
    'IssueInstant="2026-01-01T00:00:00Z"',
    inResponseTo ? `InResponseTo="${inResponseTo}"` : null,
    destination ? `Destination="${destination}"` : null,
  ]
    .filter(Boolean)
    .join(" ");
  const subject = withRecipient
    ? `<saml:Subject><saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData Recipient="${withRecipient}" InResponseTo="${inResponseTo || ""}"/></saml:SubjectConfirmation></saml:Subject>`
    : "";
  return (
    `<samlp:Response ${attrs}>` +
    `<samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>` +
    subject +
    `</samlp:Response>`
  );
}

const b64 = (xml) => Buffer.from(xml, "utf8").toString("base64");

async function errorFrom(promise) {
  return promise.then(
    () => null,
    (err) => err
  );
}

describe("F29(a) — SAML state/InResponseTo binding is mandatory (replay fix)", () => {
  it("rejects an ACS POST with no stored saml_state (empty requestId)", async () => {
    const err = await errorFrom(
      validateSamlResponse(null, { SAMLResponse: b64(responseXml({ inResponseTo: "old-id" })) }, "", SETTINGS)
    );
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/saml_state/i);
  });

  it("rejects when expectedRequestId is null/undefined (cookie gone → fail closed)", async () => {
    for (const missing of [null, undefined]) {
      const err = await errorFrom(
        validateSamlResponse(null, { SAMLResponse: b64(responseXml({ inResponseTo: "old-id" })) }, missing, SETTINGS)
      );
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toMatch(/saml_state/i);
    }
  });

  it("rejects a Response carrying no InResponseTo even when state is stored", async () => {
    const err = await errorFrom(
      validateSamlResponse(null, { SAMLResponse: b64(responseXml({})) }, "req-1", SETTINGS)
    );
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/InResponseTo/);
  });

  it("rejects a Response whose InResponseTo does not match the stored state", async () => {
    const err = await errorFrom(
      validateSamlResponse(null, { SAMLResponse: b64(responseXml({ inResponseTo: "other-req" })) }, "req-1", SETTINGS)
    );
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/InResponseTo/);
  });

  it("legitimate SP-initiated flow (matching state + destination) still passes every replay gate", async () => {
    const request = makeRequest("https://sp.example.com/api/auth/saml/acs", { host: "sp.example.com" });
    const err = await errorFrom(
      validateSamlResponse(
        request,
        { SAMLResponse: b64(responseXml({ inResponseTo: "req-1", destination: "https://sp.example.com/api/auth/saml/acs" })) },
        "req-1",
        { ...SETTINGS, baseUrl: "https://sp.example.com" }
      )
    );
    expect(err).toBeInstanceOf(Error);
    // Must fail only later, at signature validation — never at the state/destination gates.
    expect(err.message).not.toMatch(/saml_state|InResponseTo|not valid|destination|recipient/i);
  });

  it("node-saml instance enforces InResponseTo (no longer 'never')", () => {
    const instance = createSamlInstance(SETTINGS, "https://sp.example.com");
    expect(instance.options.validateInResponseTo).toBe("always");
  });
});

describe("F29(b) — SAML destination comes from SP config, never X-Forwarded-Host", () => {
  const savedEnv = {};
  beforeEach(() => {
    savedEnv.BASE_URL = process.env.BASE_URL;
    savedEnv.NEXT_PUBLIC_BASE_URL = process.env.NEXT_PUBLIC_BASE_URL;
    delete process.env.BASE_URL;
    delete process.env.NEXT_PUBLIC_BASE_URL;
  });
  afterEach(() => {
    if (savedEnv.BASE_URL !== undefined) process.env.BASE_URL = savedEnv.BASE_URL;
    if (savedEnv.NEXT_PUBLIC_BASE_URL !== undefined)
      process.env.NEXT_PUBLIC_BASE_URL = savedEnv.NEXT_PUBLIC_BASE_URL;
  });

  it("admin settings.baseUrl wins over spoofed forwarding headers", () => {
    const request = makeRequest("http://sp.example.com/api/auth/saml/acs", {
      host: "sp.example.com",
      "x-forwarded-host": "attacker.example.net",
      "x-forwarded-proto": "https",
    });
    expect(getSamlBaseUrl(request, { baseUrl: "https://configured.example" })).toBe("https://configured.example");
  });

  it("env BASE_URL wins over spoofed forwarding headers", () => {
    process.env.BASE_URL = "https://env.example";
    const request = makeRequest("http://sp.example.com/api/auth/saml/acs", {
      host: "sp.example.com",
      "x-forwarded-host": "attacker.example.net",
    });
    expect(getSamlBaseUrl(request, {})).toBe("https://env.example");
  });

  it("without config, origin falls back to the received Host header, NEVER x-forwarded-host", () => {
    const request = makeRequest("http://sp.example.com/api/auth/saml/acs", {
      host: "sp.example.com",
      "x-forwarded-host": "attacker.example.net",
      "x-forwarded-proto": "https",
    });
    const origin = getSamlBaseUrl(request, {});
    expect(origin).not.toContain("attacker.example.net");
    expect(origin).toContain("sp.example.com");
  });

  it("audits Response Destination against the config-derived ACS URL (attacker destination rejected)", async () => {
    const request = makeRequest("https://sp.example.com/api/auth/saml/acs", {
      host: "sp.example.com",
      "x-forwarded-host": "attacker.example.net",
    });
    const err = await errorFrom(
      validateSamlResponse(
        request,
        { SAMLResponse: b64(responseXml({ inResponseTo: "req-1", destination: "https://attacker.example.net/api/auth/saml/acs" })) },
        "req-1",
        { ...SETTINGS, baseUrl: "https://sp.example.com" }
      )
    );
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/destination/i);
  });

  it("tolerates a Response without Destination attribute (legacy IdPs)", async () => {
    const err = await errorFrom(
      validateSamlResponse(
        null,
        { SAMLResponse: b64(responseXml({ inResponseTo: "req-1" })) },
        "req-1",
        SETTINGS
      )
    );
    expect(err).toBeInstanceOf(Error);
    expect(err.message).not.toMatch(/destination/i);
  });

  it("audits SubjectConfirmationData Recipient against the config-derived ACS URL", async () => {
    const err = await errorFrom(
      validateSamlResponse(
        null,
        {
          SAMLResponse: b64(
            responseXml({
              inResponseTo: "req-1",
              withRecipient: "https://attacker.example.net/api/auth/saml/acs",
            })
          ),
        },
        "req-1",
        { ...SETTINGS, baseUrl: "https://sp.example.com" }
      )
    );
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/recipient/i);
  });

  it("passes a matching SubjectConfirmationData Recipient through", async () => {
    const err = await errorFrom(
      validateSamlResponse(
        null,
        {
          SAMLResponse: b64(
            responseXml({
              inResponseTo: "req-1",
              withRecipient: "https://sp.example.com/api/auth/saml/acs",
            })
          ),
        },
        "req-1",
        { ...SETTINGS, baseUrl: "https://sp.example.com" }
      )
    );
    expect(err).toBeInstanceOf(Error);
    expect(err.message).not.toMatch(/recipient|destination|saml_state|InResponseTo/i);
  });
});
