import { SAML } from "@node-saml/node-saml";
import { getSettings } from "../db/repos/settingsRepo.js";

// Lifetime of a pending AuthnRequest id. Aligned with the saml_state cookie TTL set in
// /api/auth/saml/start (10 min) so the library-side cache can never outlive the cookie.
const REQUEST_ID_TTL_MS = 10 * 60 * 1000;

/**
 * Module-level AuthnRequest id store shared by every SAML instance in this process.
 * node-saml validates Response/@InResponseTo against this cache; it must survive across
 * requests (start vs. acs are separate route invocations), so it cannot live on the
 * per-request SAML instance. Mirrors the shape of @node-saml's InMemoryCacheProvider
 * (saveAsync/getAsync/removeAsync) — that class is not exported by the package.
 * The saml_state cookie remains the authoritative cross-process binding; this cache adds
 * one-shot consumption of request ids (replay control) enforced inside node-saml.
 */
const pendingRequestIds = (() => {
  const entries = new Map();
  const prune = () => {
    const now = Date.now();
    for (const [key, entry] of entries) {
      if (now >= entry.expiresAt) entries.delete(key);
    }
  };
  return {
    async saveAsync(key, value) {
      prune();
      if (!entries.has(key)) entries.set(key, { value, expiresAt: Date.now() + REQUEST_ID_TTL_MS });
      return key;
    },
    async getAsync(key) {
      prune();
      const entry = entries.get(key);
      if (!entry) return null;
      if (Date.now() >= entry.expiresAt) {
        entries.delete(key);
        return null;
      }
      return entry.value;
    },
    async removeAsync(key) {
      const had = entries.delete(key);
      return had ? key : null;
    },
  };
})();

/**
 * Formats a raw Base64 string or unformatted X.509 certificate into standard PEM format.
 * @param {string} certStr
 * @returns {string}
 */
export function formatX509Certificate(certStr) {
  if (!certStr || typeof certStr !== "string") return "";
  const clean = certStr
    .replace(/-----BEGIN CERTIFICATE-----/gi, "")
    .replace(/-----END CERTIFICATE-----/gi, "")
    .replace(/[^A-Za-z0-9+/=]/g, "");

  if (!clean) return "";

  const lines = clean.match(/.{1,64}/g) || [];
  return `-----BEGIN CERTIFICATE-----\n${lines.join("\n")}\n-----END CERTIFICATE-----`;
}

/**
 * Checks whether SAML configuration has essential parameters (entryPoint & cert).
 * @param {object} settings
 * @returns {boolean}
 */
export function isSamlConfigured(settings) {
  return Boolean(settings?.samlEntryPoint && settings?.samlCert);
}

/**
 * Fetches settings and returns runtime status + settings.
 * @returns {Promise<{ configured: boolean, settings: object }>}
 */
export async function getSamlRuntimeConfig() {
  const settings = await getSettings();
  return {
    configured: isSamlConfigured(settings),
    settings,
  };
}

/**
 * Creates a configured `@node-saml/node-saml` SAML instance with security defaults.
 * @param {object} settings
 * @param {string} origin
 * @returns {SAML}
 */
const DUMMY_FALLBACK_CERT =
  "-----BEGIN CERTIFICATE-----\nMIIC...DUMMY...\n-----END CERTIFICATE-----";

function trimTrailingSlashes(str) {
  return (str || "").replace(/\/+$/, "");
}

/**
 * Resolves the public Base URL / Origin for SAML requests (SP-initiated AuthnRequest,
 * ACS callbackUrl and the Destination/Recipient audit). Trust order:
 *   1. settings.baseUrl (admin-configured)  2. BASE_URL env  3. NEXT_PUBLIC_BASE_URL env
 *   4. the Host header the server itself received (+ x-forwarded-proto for scheme only).
 * x-forwarded-host is deliberately NEVER consulted (T1.3-F-2/F-8, F29): any caller can
 * forge it and it would flow straight into the ACS URL the assertion Destination is
 * audited against. custom-server.js strips x-forwarded-host unconditionally (F21'); this
 * module not reading it covers dev / unwrapped `next start` as well. Same policy as
 * getPublicOrigin() in src/lib/auth/oidc.js.
 * @param {Request} request
 * @param {object} settings
 * @returns {string}
 */
export function getSamlBaseUrl(request, settings) {
  const configuredBaseUrl =
    (settings?.baseUrl || "").trim() ||
    process.env.BASE_URL ||
    process.env.NEXT_PUBLIC_BASE_URL ||
    "";

  if (configuredBaseUrl) {
    return trimTrailingSlashes(configuredBaseUrl);
  }

  if (request) {
    const forwardedProto = request?.headers?.get?.("x-forwarded-proto") || "";
    const host = request?.headers?.get?.("host") || "";
    if (host) {
      const protocol = (forwardedProto || new URL(request.url).protocol || "http:").replace(/:$/, "");
      return `${protocol}://${host}`.replace(/\/+$/, "");
    }
    if (request.url) {
      return trimTrailingSlashes(new URL(request.url).origin);
    }
  }

  return "http://localhost:20128";
}

export function createSamlInstance(settings, origin) {
  const cert = formatX509Certificate(settings?.samlCert || "") || DUMMY_FALLBACK_CERT;
  const callbackUrl = `${origin}/api/auth/saml/acs`;
  return new SAML({
    entryPoint: settings?.samlEntryPoint || "https://example.com/sso",
    issuer: settings?.samlIssuer || "urn:9router:sp",
    idpCert: cert,
    cert: cert,
    callbackUrl: callbackUrl,
    acceptedClockSkewMs: 60000,
    wantAssertionsSigned: true,
    // F29 / T1.3-F-2: "never" let any IdP-signed assertion be replayed to the ACS.
    // "always" makes node-saml itself reject Responses whose InResponseTo is missing or
    // not present in the shared pending-request cache (validateSamlResponse seeds it
    // from the saml_state cookie, which /api/auth/saml/start also stores into).
    validateInResponseTo: "always",
    cacheProvider: pendingRequestIds,
    requestIdExpirationMs: REQUEST_ID_TTL_MS,
  });
}

/**
 * Builds SAML AuthnRequest redirect URL and returns { authorizeUrl, requestId }.
 * @param {Request} request
 * @param {object} settings
 * @returns {Promise<{ authorizeUrl: string, requestId: string }>}
 */
export async function buildSamlAuthorizeUrl(request, settings) {
  const origin = getSamlBaseUrl(request, settings);
  const samlInstance = createSamlInstance(settings, origin);

  const xml = await samlInstance.generateAuthorizeRequestAsync(false, false);
  const match = xml.match(/ID="([^"]+)"/);
  const requestId = match ? match[1] : "";

  const authorizeUrl = await samlInstance._requestToUrlAsync(xml, null, "authorize", {});

  return { authorizeUrl, requestId };
}

/**
 * Validates SAML POST response from IdP ACS callback and returns user profile.
 * Hardening (T1.3-F-2 / F29):
 *  - expectedRequestId (the saml_state cookie set by /api/auth/saml/start) is REQUIRED.
 *    Without it the Response cannot be bound to an AuthnRequest we issued, so login
 *    fails closed — this is what previously allowed plain replay of a captured
 *    IdP-signed assertion (and drops IdP-initiated SSO support by design).
 *  - Response/@InResponseTo must equal that state (and node-saml re-validates it
 *    against the shared request-id cache, which consumes the id on use).
 *  - Response/@Destination and SubjectConfirmationData/@Recipient, when present, must
 *    equal the config-derived ACS URL — @node-saml/node-saml 5.1.0 checks neither.
 * @param {Request} request
 * @param {object} body - Parsed form body or object containing SAMLResponse
 * @param {string} expectedRequestId - Request ID stored in saml_state cookie (required)
 * @param {object} settings
 * @returns {Promise<object>}
 */
export async function validateSamlResponse(request, body, expectedRequestId, settings) {
  if (!settings?.samlCert) {
    throw new Error("IdP X.509 Certificate (samlCert) is missing or not configured");
  }

  const origin = getSamlBaseUrl(request, settings);
  const samlInstance = createSamlInstance(settings, origin);

  const container = typeof body === "object" && body !== null ? body : { SAMLResponse: body };
  const rawSamlResponse = container.SAMLResponse;

  if (!rawSamlResponse) {
    throw new Error("Missing SAMLResponse parameter in assertion POST body");
  }

  // F29: the saml_state cookie is the state store. No cookie / no stored request id →
  // fail closed. Previously a missing cookie silently relaxed every replay check.
  if (!expectedRequestId) {
    throw new Error(
      "Missing SAML login state (saml_state): refusing an assertion not bound to a SP-initiated AuthnRequest (replay protection)"
    );
  }

  const xml = Buffer.from(rawSamlResponse, "base64").toString("utf8");

  // 1) The Response must reference the AuthnRequest id we stored in saml_state.
  const match = xml.match(/InResponseTo=["']([^"']+)["']/i);
  const inResponseTo = match ? match[1] : null;

  if (!inResponseTo || inResponseTo !== expectedRequestId) {
    throw new Error(`InResponseTo mismatch: expected ${expectedRequestId}, received ${inResponseTo || "none"}`);
  }

  // 2) Destination audit: node-saml 5.1.0 never checks Response/@Destination nor
  // SubjectConfirmationData/@Recipient, so an assertion issued for a different SP
  // ("assertion forwarding") sailed through. Both must match OUR config-derived ACS URL
  // when present (absent Destination is tolerated for legacy IdPs; the InResponseTo
  // binding above and the Recipient/audience checks carry the load there).
  const acsUrl = samlInstance.options.callbackUrl;
  const destinationMatch = xml.match(/Destination=["']([^"']+)["']/i);
  if (destinationMatch && destinationMatch[1] !== acsUrl) {
    throw new Error(`SAML Destination mismatch: expected ${acsUrl}, received ${destinationMatch[1]}`);
  }
  const recipientMatch = xml.match(/Recipient=["']([^"']+)["']/i);
  if (recipientMatch && recipientMatch[1] !== acsUrl) {
    throw new Error(`SAML SubjectConfirmationData Recipient mismatch: expected ${acsUrl}, received ${recipientMatch[1]}`);
  }

  // Seed the shared request-id cache so node-saml's validateInResponseTo:"always"
  // passes for the legitimate state even across process restarts (the cookie is the
  // authoritative store; start already seeded this id in-process in the common case).
  await pendingRequestIds.saveAsync(expectedRequestId, new Date().toISOString());

  const result = await samlInstance.validatePostResponseAsync({ SAMLResponse: rawSamlResponse });
  const profile = result?.profile || result;

  return profile;
}

/**
 * Generates standard SP XML Metadata.
 * @param {string} origin
 * @param {object} settings
 * @returns {string}
 */
export function generateSamlMetadata(origin, settings) {
  const samlInstance = createSamlInstance(settings, origin);
  return samlInstance.generateServiceProviderMetadata();
}

/**
 * Extracts email claim from SAML profile assertion.
 * @param {object} profile
 * @param {object} settings
 * @returns {string}
 */
export function pickSamlEmail(profile = {}, settings = {}) {
  if (!profile) return "";

  // 1. Configured custom attribute
  const customAttr = settings.samlAttributeEmail;
  if (customAttr && profile[customAttr]) {
    const val = profile[customAttr];
    return Array.isArray(val) ? val[0] : String(val);
  }

  // 2. Common email claims
  const emailKeys = [
    "email",
    "emailAddress",
    "mail",
    "nameID",
    "nameId",
    "upn",
    "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress",
    "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier",
    "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn",
  ];

  for (const key of emailKeys) {
    if (profile[key]) {
      const val = profile[key];
      return Array.isArray(val) ? val[0] : String(val);
    }
  }

  // 3. Fallback: check attributes object if present
  if (profile.attributes) {
    for (const key of emailKeys) {
      if (profile.attributes[key]) {
        const val = profile.attributes[key];
        return Array.isArray(val) ? val[0] : String(val);
      }
    }
  }

  return "";
}

/**
 * Extracts display name claim from SAML profile assertion.
 * @param {object} profile
 * @param {object} settings
 * @returns {string}
 */
export function pickSamlDisplayName(profile = {}, settings = {}) {
  if (!profile) return "";

  // 1. Configured custom attribute
  const customAttr = settings.samlAttributeName;
  if (customAttr && profile[customAttr]) {
    const val = profile[customAttr];
    return Array.isArray(val) ? val[0] : String(val);
  }

  // 2. Common name claims
  const nameKeys = [
    "displayName",
    "name",
    "cn",
    "commonName",
    "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name",
    "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname",
  ];

  for (const key of nameKeys) {
    if (profile[key]) {
      const val = profile[key];
      return Array.isArray(val) ? val[0] : String(val);
    }
  }

  // 3. Combined givenName + surname
  if (profile.givenName || profile.sn || profile.surname) {
    const given = profile.givenName || "";
    const surname = profile.sn || profile.surname || "";
    const combined = `${given} ${surname}`.trim();
    if (combined) return combined;
  }

  // 4. Fallback to email
  return pickSamlEmail(profile, settings);
}
