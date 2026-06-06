import crypto from "node:crypto";
import { getSettings } from "@/lib/localDb";
import { getPublicOrigin } from "@/lib/auth/oidc";

export const CAS_COOKIE_NAMES = {
  state: "cas_state",
};

const DEFAULT_VALIDATE_PATH = "/p3/serviceValidate";
const DEFAULT_LOGIN_LABEL = "Sign in with CAS";

function trimTrailingSlashes(value) {
  return (value || "").trim().replace(/\/+$/, "");
}

function normalizePath(value) {
  const path = (value || DEFAULT_VALIDATE_PATH).trim() || DEFAULT_VALIDATE_PATH;
  return path.startsWith("/") ? path : `/${path}`;
}

function decodeXml(value = "") {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function firstXmlTagValue(xml, localName) {
  const match = xml.match(new RegExp(`<(?:[\\w.-]+:)?${localName}\\b[^>]*>([\\s\\S]*?)</(?:[\\w.-]+:)?${localName}>`, "i"));
  return match ? decodeXml(match[1].trim()) : "";
}

function parseCasAttributes(xml) {
  const attributesBlock = xml.match(/<(?:[\w.-]+:)?attributes\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?attributes>/i)?.[1] || "";
  const attributes = {};

  for (const match of attributesBlock.matchAll(/<(?:[\w.-]+:)?([\w.-]+)\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?\1>/g)) {
    const key = match[1];
    const value = decodeXml(match[2].trim());
    if (!key || key === "attributes") continue;
    if (attributes[key] === undefined) {
      attributes[key] = value;
    } else if (Array.isArray(attributes[key])) {
      attributes[key].push(value);
    } else {
      attributes[key] = [attributes[key], value];
    }
  }

  return attributes;
}

function pickAttribute(attributes, keys) {
  for (const key of keys) {
    const value = attributes[key];
    if (Array.isArray(value) && value[0]) return value[0];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export function createCasState() {
  return crypto.randomBytes(16).toString("base64url");
}

export function isCasConfigured(settings) {
  return !!trimTrailingSlashes(settings?.casServerUrl);
}

export async function getCasRuntimeConfig() {
  const settings = await getSettings();
  if (!["cas", "both"].includes(settings.authMode) || !isCasConfigured(settings)) return null;

  return {
    serverUrl: trimTrailingSlashes(settings.casServerUrl),
    validatePath: normalizePath(settings.casValidatePath),
    loginLabel: (settings.casLoginLabel || DEFAULT_LOGIN_LABEL).trim() || DEFAULT_LOGIN_LABEL,
  };
}

export function buildCasServiceUrl(request, state) {
  const serviceUrl = new URL(`${getPublicOrigin(request)}/api/auth/cas/callback`);
  serviceUrl.searchParams.set("state", state);
  return serviceUrl.toString();
}

export function buildCasLoginUrl({ serverUrl, serviceUrl }) {
  const url = new URL(`${trimTrailingSlashes(serverUrl)}/login`);
  url.searchParams.set("service", serviceUrl);
  return url.toString();
}

export function buildCasValidationUrl({ serverUrl, validatePath = DEFAULT_VALIDATE_PATH, serviceUrl, ticket }) {
  const url = new URL(`${trimTrailingSlashes(serverUrl)}${normalizePath(validatePath)}`);
  url.searchParams.set("service", serviceUrl);
  url.searchParams.set("ticket", ticket);
  return url.toString();
}

export async function validateCasTicket({ serverUrl, validatePath, serviceUrl, ticket }) {
  const validationUrl = buildCasValidationUrl({ serverUrl, validatePath, serviceUrl, ticket });
  const res = await fetch(validationUrl, { cache: "no-store" });
  const text = await res.text();

  if (!res.ok) {
    throw new Error(`CAS ticket validation failed (${res.status})`);
  }

  const failure = firstXmlTagValue(text, "authenticationFailure");
  if (failure) {
    throw new Error(failure || "CAS authentication failed");
  }

  const user = firstXmlTagValue(text, "user");
  if (!user) {
    throw new Error("CAS validation response did not include a user");
  }

  const attributes = parseCasAttributes(text);
  return {
    user,
    attributes,
    displayName: pickCasDisplayName({ user, attributes }),
    email: pickCasEmail(attributes),
  };
}

export async function probeCasServer({ serverUrl, validatePath = DEFAULT_VALIDATE_PATH, serviceUrl }) {
  const validationUrl = buildCasValidationUrl({
    serverUrl,
    validatePath,
    serviceUrl,
    ticket: "__cas_test_invalid_ticket__",
  });
  const res = await fetch(validationUrl, { cache: "no-store" });
  const text = await res.text().catch(() => "");
  const failure = firstXmlTagValue(text, "authenticationFailure");

  if (res.ok && failure) {
    return { ok: true, status: res.status, message: "CAS validation endpoint responded correctly." };
  }
  if (res.ok) {
    return { ok: true, status: res.status, message: "CAS validation endpoint responded." };
  }
  return { ok: false, status: res.status, message: `CAS validation endpoint returned ${res.status}` };
}

export function pickCasDisplayName({ user, attributes = {} }) {
  return pickAttribute(attributes, ["displayName", "display_name", "name", "cn", "givenName", "nickname"]) || user || "CAS user";
}

export function pickCasEmail(attributes = {}) {
  return pickAttribute(attributes, ["email", "mail", "emailAddress", "preferredEmail"]);
}

