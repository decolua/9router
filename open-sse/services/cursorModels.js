/**
 * Cursor live model catalog fetcher.
 *
 * Cursor exposes the account-specific model picker through the AiService
 * `AvailableModels` Connect RPC. Unlike the static provider registry, this
 * includes models newly enabled for the account, variants and aliases.
 */

import crypto from "crypto";
import http2 from "http2";
import { PROVIDER_OAUTH } from "../providers/index.js";
import { buildCursorHeaders } from "../utils/cursorChecksum.js";
import { decodeMessage, encodeField } from "../utils/cursorProtobuf.js";

const FETCH_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const PROTOBUF_VARINT = 0;
const PROTOBUF_LEN = 2;

// agent.v1.ModelDetails protobuf field numbers (legacy catalog fallback).
const MODEL_ID_FIELD = 1;
const DISPLAY_MODEL_ID_FIELD = 3;
const DISPLAY_NAME_FIELD = 4;
const DISPLAY_NAME_SHORT_FIELD = 5;
const USABLE_MODELS_FIELD = 1;

// aiserver.v1.AvailableModelsResponse fields. This is the catalog used by the
// current Cursor model picker and includes canonical IDs plus variants.
const AVAILABLE_MODELS_FIELD = 2;
const AVAILABLE_MODEL_NAME_FIELD = 1;
const AVAILABLE_MODEL_CLIENT_NAME_FIELD = 17;
const AVAILABLE_MODEL_SERVER_NAME_FIELD = 18;
const AVAILABLE_MODEL_INPUTBOX_NAME_FIELD = 24;
const AVAILABLE_MODEL_VARIANTS_FIELD = 30;
const AVAILABLE_MODEL_LEGACY_SLUGS_FIELD = 36;
const AVAILABLE_MODEL_ID_ALIASES_FIELD = 37;
const VARIANT_PARAMETERS_FIELD = 1;
const VARIANT_DISPLAY_NAME_FIELD = 2;
const VARIANT_IS_MAX_MODE_FIELD = 3;
const VARIANT_DISPLAY_NAME_OUTSIDE_PICKER_FIELD = 8;
const VARIANT_STRING_FIELD = 9;
const VARIANT_LEGACY_SLUG_FIELD = 11;
const PARAMETER_ID_FIELD = 1;
const PARAMETER_VALUE_FIELD = 2;

/** @type {Map<string, { expiresAt: number, models: object[] }>} */
const catalogCache = new Map();

function getCursorModelsUrl() {
  const config = PROVIDER_OAUTH.cursor;
  if (!config?.apiEndpoint || !config?.availableModelsEndpoint) return null;
  return `${config.apiEndpoint.replace(/\/$/, "")}${config.availableModelsEndpoint}`;
}

function cacheKey(credentials) {
  const seed = [
    credentials?.providerSpecificData?.machineId,
    credentials?.accessToken,
  ].filter(Boolean).join(":");
  if (!seed) return "cursor-anonymous";
  return crypto.createHash("sha256").update(`cursor:${seed}`).digest("hex");
}

function valueAsString(value) {
  if (!value || typeof value === "number") return "";
  return Buffer.from(value).toString("utf8");
}

function firstString(fields, fieldNumber) {
  const value = fields.get(fieldNumber)?.[0]?.value;
  return valueAsString(value);
}

function allStrings(fields, fieldNumber) {
  return (fields.get(fieldNumber) || [])
    .map(({ value }) => valueAsString(value).trim())
    .filter(Boolean);
}

function firstBool(fields, fieldNumber) {
  const value = fields.get(fieldNumber)?.[0]?.value;
  return typeof value === "number" ? value !== 0 : false;
}

function concatBytes(...parts) {
  const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function encodeAvailableModelsRequest(additionalModelNames = []) {
  return concatBytes(
    // Match Cursor 3.13.25's model-picker request.
    encodeField(3, PROTOBUF_VARINT, 1), // exclude_max_named_models
    encodeField(5, PROTOBUF_VARINT, 1), // use_model_parameters
    ...additionalModelNames
      .filter((name) => typeof name === "string" && name.trim())
      .map((name) => encodeField(4, PROTOBUF_LEN, name.trim())),
    encodeField(11, PROTOBUF_VARINT, 1), // use_react_model_picker
  );
}

/**
 * Decode Cursor's `agent.v1.GetUsableModelsResponse` protobuf payload.
 * The response contains repeated `agent.v1.ModelDetails` messages in field 1.
 */
export function parseCursorUsableModels(payload) {
  const response = decodeMessage(payload);
  const seen = new Set();
  const models = [];

  for (const entry of response.get(USABLE_MODELS_FIELD) || []) {
    if (!entry?.value || typeof entry.value === "number") continue;
    const detail = decodeMessage(entry.value);
    const id = firstString(detail, MODEL_ID_FIELD).trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const name = (
      firstString(detail, DISPLAY_NAME_FIELD)
      || firstString(detail, DISPLAY_NAME_SHORT_FIELD)
      || firstString(detail, DISPLAY_MODEL_ID_FIELD)
      || id
    ).trim();
    models.push({ id, name });
  }

  return models;
}

function parseParameterValue(payload) {
  const fields = decodeMessage(payload);
  const id = firstString(fields, PARAMETER_ID_FIELD).trim();
  const value = firstString(fields, PARAMETER_VALUE_FIELD);
  return id ? { id, value } : null;
}

function parseModelVariant(payload) {
  const fields = decodeMessage(payload);
  const parameters = (fields.get(VARIANT_PARAMETERS_FIELD) || [])
    .map(({ value }) => parseParameterValue(value))
    .filter(Boolean);
  return {
    parameters,
    displayName: firstString(fields, VARIANT_DISPLAY_NAME_FIELD).trim(),
    displayNameOutsidePicker: firstString(fields, VARIANT_DISPLAY_NAME_OUTSIDE_PICKER_FIELD).trim(),
    isMaxMode: firstBool(fields, VARIANT_IS_MAX_MODE_FIELD),
    variantStringRepresentation: firstString(fields, VARIANT_STRING_FIELD).trim(),
    legacySlug: firstString(fields, VARIANT_LEGACY_SLUG_FIELD).trim(),
  };
}

/**
 * Decode the current Cursor model-picker catalog. The model name is the
 * canonical ID used by AgentService; legacy slugs and variant strings are
 * retained so callers can translate user-facing model IDs before Run.
 */
export function parseCursorAvailableModels(payload) {
  const response = decodeMessage(payload);
  const seen = new Set();
  const models = [];

  for (const entry of response.get(AVAILABLE_MODELS_FIELD) || []) {
    if (!entry?.value || typeof entry.value === "number") continue;
    const fields = decodeMessage(entry.value);
    const id = firstString(fields, AVAILABLE_MODEL_NAME_FIELD).trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const legacySlugs = allStrings(fields, AVAILABLE_MODEL_LEGACY_SLUGS_FIELD);
    const idAliases = allStrings(fields, AVAILABLE_MODEL_ID_ALIASES_FIELD);
    const variants = (fields.get(AVAILABLE_MODEL_VARIANTS_FIELD) || [])
      .map(({ value }) => parseModelVariant(value));
    const serverModelName = firstString(fields, AVAILABLE_MODEL_SERVER_NAME_FIELD).trim();
    const clientDisplayName = (
      firstString(fields, AVAILABLE_MODEL_CLIENT_NAME_FIELD)
      || firstString(fields, AVAILABLE_MODEL_INPUTBOX_NAME_FIELD)
      || id
    ).trim();

    models.push({
      id,
      name: clientDisplayName,
      serverModelName,
      legacySlugs,
      idAliases,
      variants,
    });
  }

  return models;
}

function variantMatches(variant, requestedModel) {
  return variant.variantStringRepresentation === requestedModel
    || variant.legacySlug === requestedModel;
}

function displayNameWithoutMarkup(value, fallback) {
  const clean = String(value || "")
    .replace(/<[^>]*>/g, "")
    .replace(/\u200b/g, "")
    .trim();
  return clean || fallback;
}

/**
 * Keep Cursor's legacy variant slugs visible to OpenAI-compatible clients.
 * They remain aliases only; resolveCursorModelSelection maps them back to the
 * canonical model and parameter values before AgentService.Run.
 */
export function expandCursorModelAliases(models) {
  if (!Array.isArray(models)) return [];
  const result = [];
  const seen = new Set();
  const add = (model) => {
    if (!model?.id || seen.has(model.id)) return;
    seen.add(model.id);
    result.push(model);
  };

  for (const model of models) {
    add(model);
    for (const variant of model.variants || []) {
      const alias = variant.legacySlug;
      if (!alias || alias === model.id) continue;
      add({
        id: alias,
        name: displayNameWithoutMarkup(
          variant.displayNameOutsidePicker || variant.displayName,
          alias,
        ),
        canonicalModelId: model.id,
        parameters: variant.parameters,
        isVariantAlias: true,
      });
    }
    for (const alias of [...(model.legacySlugs || []), ...(model.idAliases || [])]) {
      if (!alias || alias === model.id) continue;
      add({
        id: alias,
        name: model.name || alias,
        canonicalModelId: model.id,
        parameters: [],
        isVariantAlias: true,
      });
    }
  }

  return result;
}

/**
 * Resolve a static/legacy model slug to the canonical AgentService model ID
 * and the exact parameter values selected by Cursor's model picker.
 */
export function resolveCursorModelSelection(models, requestedModel) {
  const requested = typeof requestedModel === "string" ? requestedModel.trim() : "";
  if (!requested || !Array.isArray(models)) return null;

  // A request with additional_model_names can make Cursor echo a legacy slug
  // as a synthetic exact model entry. Prefer the real variant metadata first.
  for (const model of models) {
    const variant = (model?.variants || []).find((candidate) => variantMatches(candidate, requested));
    if (variant) {
      return {
        modelId: model.id,
        parameters: variant.parameters,
        maxMode: variant.isMaxMode === true,
        builtInModel: true,
        isVariantStringRepresentation: false,
        matchedBy: variant.variantStringRepresentation === requested
          ? "variant"
          : "variant-legacy-slug",
      };
    }

    if ([...(model?.legacySlugs || []), ...(model?.idAliases || [])].includes(requested)) {
      return {
        modelId: model.id,
        parameters: [],
        maxMode: false,
        builtInModel: true,
        isVariantStringRepresentation: false,
        matchedBy: "model-alias",
      };
    }
  }

  const canonical = models.find((model) => model?.id === requested);
  if (canonical) {
    return {
      modelId: canonical.id,
      parameters: [],
      maxMode: false,
      builtInModel: true,
      isVariantStringRepresentation: false,
      matchedBy: "canonical",
    };
  }

  return null;
}

/**
 * Cursor's unary model catalog is HTTP/2-only; Node fetch/undici cannot speak
 * h2. AvailableModels uses an unframed protobuf body (application/proto).
 */
function http2PostProto(url, headers, body, signal, timeoutMs) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const client = http2.connect(`https://${urlObj.host}`);
    const chunks = [];
    let responseHeaders = {};
    let settled = false;

    const finish = (fn) => (...args) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      try { client.close(); } catch {}
      fn(...args);
    };

    const timeoutId = setTimeout(finish(() => {
      reject(new Error("Cursor AvailableModels timed out"));
    }), timeoutMs);

    client.on("error", finish(reject));

    const req = client.request({
      ":method": "POST",
      ":path": `${urlObj.pathname}${urlObj.search}`,
      ":authority": urlObj.host,
      ":scheme": "https",
      ...headers,
    });

    req.on("response", (hdrs) => { responseHeaders = hdrs; });
    req.on("data", (chunk) => { chunks.push(chunk); });
    req.on("end", finish(() => {
      resolve({
        status: Number(responseHeaders[":status"] || 0),
        body: Buffer.concat(chunks),
      });
    }));
    req.on("error", finish(reject));

    if (signal) {
      const onAbort = finish(() => reject(new Error("Request aborted")));
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }

    req.end(body && body.length ? Buffer.from(body) : undefined);
  });
}

async function fetchCursorCatalog(credentials, signal, additionalModelNames = []) {
  const accessToken = credentials?.accessToken;
  const machineId = credentials?.providerSpecificData?.machineId;
  const url = getCursorModelsUrl();
  if (!accessToken || !machineId || !url) return null;

  const headers = {
    ...buildCursorHeaders(accessToken, machineId, credentials?.providerSpecificData?.ghostMode !== false),
    // Connect unary calls use an unframed protobuf body, unlike Cursor chat's
    // streaming `application/connect+proto` endpoint.
    accept: "application/proto",
    "content-type": "application/proto",
  };
  delete headers["connect-accept-encoding"];
  delete headers["connect-protocol-version"];

  const response = await http2PostProto(
    url,
    headers,
    encodeAvailableModelsRequest(additionalModelNames),
    signal,
    FETCH_TIMEOUT_MS,
  );
  if (response.status !== 200) {
    const error = new Error(`Cursor AvailableModels returned ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return parseCursorAvailableModels(new Uint8Array(response.body));
}

/**
 * Resolve the live Cursor catalog for the authenticated account.
 * Returns null on any failure so callers can fall back to static models.
 */
export async function resolveCursorModels(credentials, options = {}) {
  if (!credentials?.accessToken || !credentials?.providerSpecificData?.machineId) {
    options.log?.debug?.("CURSOR_MODELS", "No Cursor access token or machine ID; skipping live fetch");
    return null;
  }

  const key = cacheKey(credentials);
  const now = Date.now();
  if (!options.forceRefresh) {
    const cached = catalogCache.get(key);
    if (cached?.expiresAt > now) return { models: cached.models };
  }

  try {
    const models = await fetchCursorCatalog(credentials, options.signal, options.additionalModelNames);
    if (!models?.length) return null;
    catalogCache.set(key, { expiresAt: now + CACHE_TTL_MS, models });
    return { models };
  } catch (error) {
    options.log?.warn?.("CURSOR_MODELS", `Live model fetch failed: ${error?.message || error}`);
    return null;
  }
}

/**
 * Resolve one requested model using the account-specific catalog. The second
 * fetch handles a model first seen after the five-minute cache was populated.
 */
export async function resolveCursorModel(credentials, requestedModel, options = {}) {
  const additionalModelNames = typeof requestedModel === "string" && requestedModel.trim()
    ? [requestedModel]
    : [];
  let result = await resolveCursorModels(credentials, { ...options, additionalModelNames });
  let selection = resolveCursorModelSelection(result?.models, requestedModel);
  if (selection || !result?.models?.length || options.forceRefresh) return selection;

  result = await resolveCursorModels(credentials, {
    ...options,
    forceRefresh: true,
    additionalModelNames,
  });
  selection = resolveCursorModelSelection(result?.models, requestedModel);
  return selection;
}

export function clearCursorModelCache() {
  catalogCache.clear();
}
