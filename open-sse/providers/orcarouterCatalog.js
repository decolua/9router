/**
 * OrcaRouter catalog + origin helpers.
 *
 * Shared by the registry entry, the OAuth module, the model-discovery API seam
 * and the dashboard so the capability rules and the two public origins are
 * defined once.
 *
 * Authentication and inference live on *different* public origins. Never derive
 * one from the other by swapping a hostname or appending `/v1`: the relay sits
 * on `api.orcarouter.ai` at `/v1`, while the login endpoints are on
 * `www.orcarouter.ai` under `/api/v1/auth`. `https://api.orcarouter.ai/v1/auth/keys`
 * is a 404.
 */

export const ORCAROUTER_ID = "orcarouter";

export const ORCAROUTER_AUTH_BASE_DEFAULT = "https://www.orcarouter.ai";
export const ORCAROUTER_API_BASE_DEFAULT = "https://api.orcarouter.ai";

// Paths are fixed; only the origins are configurable.
export const ORCAROUTER_AUTHORIZE_PATH = "/auth";
export const ORCAROUTER_EXCHANGE_PATH = "/api/v1/auth/keys";
export const ORCAROUTER_CATALOG_PATH = "/v1/models";
export const ORCAROUTER_CONSOLE_URL = "https://www.orcarouter.ai/console/authorized-apps";
/** Public prefix of every OrcaRouter key; used for validation and redaction. */
export const ORCAROUTER_KEY_PREFIX = "sk-orca-";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function normalizeBase(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return "";
  return raw.replace(/\/+$/, "");
}

/**
 * Pick a base origin: explicit override → shared self-hosted fallback → default.
 * The explicit override always wins; a shared value is only a fallback.
 */
export function resolveOrcaBase({ explicit, shared, fallback } = {}) {
  return normalizeBase(explicit) || normalizeBase(shared) || normalizeBase(fallback);
}

/**
 * Authentication origin. `ORCA_AUTH_BASE_URL` → `ORCA_BASE_URL` → public default.
 */
export function resolveAuthBase(env = {}) {
  return resolveOrcaBase({
    explicit: env.ORCA_AUTH_BASE_URL,
    shared: env.ORCA_BASE_URL,
    fallback: ORCAROUTER_AUTH_BASE_DEFAULT,
  });
}

/**
 * Inference/catalog origin. `ORCA_API_BASE_URL` → `ORCA_BASE_URL` → public default.
 * The suffix is a call-site concern so callers keep control of the path.
 */
export function resolveApiBase(env = {}) {
  return resolveOrcaBase({
    explicit: env.ORCA_API_BASE_URL,
    shared: env.ORCA_BASE_URL,
    fallback: ORCAROUTER_API_BASE_DEFAULT,
  });
}

/**
 * Redacted, non-secret handle for a stored credential.
 *
 * Only the fixed `sk-orca-` prefix and the last few characters are exposed, so
 * this value is safe to persist and render. It exists because the connections
 * API strips the secret itself: the browser needs *some* way to confirm which key
 * is installed without ever holding it.
 */
export function credentialHint(secret) {
  if (typeof secret !== "string") return null;
  const trimmed = secret.trim();
  if (trimmed.length < 12) return null;
  const prefix = trimmed.startsWith(ORCAROUTER_KEY_PREFIX) ? ORCAROUTER_KEY_PREFIX : trimmed.slice(0, 6);
  return `${prefix}…${trimmed.slice(-4)}`;
}

/**
 * Remote (non-loopback) origins must be HTTPS; plain HTTP is only tolerated for
 * loopback development, matching the self-hosted story.
 */
export function isAllowedOrcaOrigin(origin) {
  let url;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol === "https:") return true;
  if (url.protocol !== "http:") return false;
  return LOOPBACK_HOSTS.has(url.hostname);
}

export function buildAuthorizeUrl({ authBase, codeChallenge, state, appName, scope = "api", callbackUrl = "oob" }) {
  const base = normalizeBase(authBase) || ORCAROUTER_AUTH_BASE_DEFAULT;
  const url = new URL(`${base}${ORCAROUTER_AUTHORIZE_PATH}`);
  url.searchParams.set("callback_url", callbackUrl);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  if (appName) url.searchParams.set("app_name", appName);
  if (scope) url.searchParams.set("scope", scope);
  return url.toString();
}

export function buildExchangeUrl({ authBase }) {
  const base = normalizeBase(authBase) || ORCAROUTER_AUTH_BASE_DEFAULT;
  return `${base}${ORCAROUTER_EXCHANGE_PATH}`;
}

export function buildCatalogUrl({ apiBase, capability }) {
  const base = normalizeBase(apiBase) || ORCAROUTER_API_BASE_DEFAULT;
  const url = new URL(`${base}${ORCAROUTER_CATALOG_PATH}`);
  if (capability) url.searchParams.set("capability", capability);
  return url.toString();
}

// ── capabilities ────────────────────────────────────────────────────────────

/** Catalog capabilities this integration knows how to consume. */
export const ORCAROUTER_CAPABILITIES = ["chat", "embedding", "image", "video", "rerank"];

/** Non-text input modalities a caller may narrow a chat catalog by. */
export const ORCAROUTER_MODALITIES = ["image", "audio", "video"];

/** Endpoint types that can serve an OpenAI/Claude/Gemini chat request. */
const TEXT_ENDPOINT_TYPES = new Set([
  "openai",
  "openai-response",
  "openai-responses",
  "anthropic",
  "gemini",
]);

/** Endpoint types that prove a model is *not* a general text model. */
const NON_TEXT_ENDPOINT_TYPES = new Set([
  "image-generation",
  "openai-video",
  "jina-rerank",
  "embedding",
  "embeddings",
  "tts",
  "stt",
]);

const NON_TEXT_MODALITIES = new Set(["image", "audio", "video"]);

/** Requested capability → the catalog `capability` query value. */
const CAPABILITY_QUERY = {
  chat: "chat",
  embedding: "embedding",
  image: "image",
  video: "video",
  rerank: "rerank",
};

function asStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((v) => typeof v === "string" && v.trim()).map((v) => v.trim());
}

/** `supported_endpoint_types` (catalog) / `supportedEndpointTypes` / normalized `endpointTypes`. */
function endpointTypesOf(model) {
  return asStringArray(
    model?.supported_endpoint_types ??
      model?.supportedEndpointTypes ??
      model?.endpointTypes
  );
}

/** Declared input modalities, or [] when the catalog omits them. */
function inputModalitiesOf(model) {
  return asStringArray(
    model?.architecture?.input_modalities ??
      model?.input_modalities ??
      model?.inputModalities
  );
}

function outputModalitiesOf(model) {
  return asStringArray(
    model?.architecture?.output_modalities ??
      model?.output_modalities ??
      model?.outputModalities
  );
}
function numericOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Normalise one catalog record, or null when the record is unusable.
 * Vendor namespaces are preserved verbatim (`openai/gpt-5.5` stays as-is).
 *
 * Seed entries run through this too, so callers can rely on the same shape
 * (`reasoningEfforts` is always an array) regardless of where a model came from.
 */
export function normalizeCatalogEntry(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  if (!id) return null;

  const endpointTypes = endpointTypesOf(raw);
  return {
    id,
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : id,
    contextLength: numericOrNull(raw.context_length ?? raw.contextLength),
    inputModalities: inputModalitiesOf(raw),
    outputModalities: outputModalitiesOf(raw),
    endpointTypes,
    reasoning: raw.reasoning === true || Array.isArray(raw.reasoning_efforts) || Array.isArray(raw.reasoningEfforts),
    reasoningEfforts: asStringArray(raw.reasoning_efforts ?? raw.reasoningEfforts),
  };
}

/**
 * Can this model serve a text chat request?
 * Models advertising only media endpoint types are excluded; records with no
 * endpoint metadata fall back to their declared output modality.
 */
export function isTextChatModel(model) {
  const types = endpointTypesOf(model);
  if (types.length) return types.some((t) => TEXT_ENDPOINT_TYPES.has(t));
  const outputs = outputModalitiesOf(model);
  if (outputs.length) return outputs.includes("text");
  return true;
}

/**
 * Fail-closed modality check: a model may only appear in a multimodal picker
 * when the catalog explicitly declares that input modality. A missing
 * declaration is a rejection, never an assumption.
 */
export function supportsModality(model, modality) {
  if (!NON_TEXT_MODALITIES.has(modality)) return true;
  return inputModalitiesOf(model).includes(modality);
}

/** Capability match for a single model, independent of any entry point. */
export function matchesCapability(model, capability) {
  if (!capability || capability === "chat") return isTextChatModel(model);
  const types = endpointTypesOf(model);
  switch (capability) {
    case "embedding":
      return types.length ? types.includes("embedding") : outputModalitiesOf(model).includes("embedding");
    case "image":
      return types.length ? types.includes("image-generation") : outputModalitiesOf(model).includes("image");
    case "video":
      return types.includes("openai-video");
    case "rerank":
      return types.includes("jina-rerank");
    default:
      return false;
  }
}

/**
 * Filter a catalog for one entry point.
 *
 * `capability` selects the endpoint family (see ORCAROUTER_CAPABILITIES) and
 * `modality` applies the strict, fail-closed multimodal restriction on top of
 * the capability match.
 */
export function filterCatalog(models, { capability = "chat", modality = null } = {}) {
  if (!Array.isArray(models)) return [];
  return models.filter((m) => {
    if (!matchesCapability(m, capability)) return false;
    if (modality && capability === "chat") return supportsModality(m, modality);
    return true;
  });
}

// ── verified cold-start seed ────────────────────────────────────────────────

/**
 * Small, verified fallback used only when live discovery fails, and never mixed
 * into a successful live result. Ids follow the vendor/model namespace the
 * relay uses; the context windows, input modalities and reasoning support
 * mirror the verified metadata this repository already carries for the same
 * underlying models (open-sse/providers/capabilities.js and thinkingLevels.js).
 */
export const ORCAROUTER_SEED_MODELS = [
  {
    id: "openai/gpt-5.5",
    name: "GPT-5.5",
    contextLength: 400000,
    inputModalities: ["text", "image"],
    endpointTypes: ["openai"],
    reasoning: true,
    reasoningEfforts: ["low", "medium", "high", "xhigh"],
  },
  {
    id: "anthropic/claude-opus-4.8",
    name: "Claude Opus 4.8",
    contextLength: 1000000,
    inputModalities: ["text", "image"],
    endpointTypes: ["anthropic"],
    reasoning: true,
  },
  {
    id: "google/gemini-3.5-flash",
    name: "Gemini 3.5 Flash",
    contextLength: 1048576,
    inputModalities: ["text", "image", "audio", "video"],
    endpointTypes: ["gemini"],
    reasoning: true,
  },
  {
    id: "deepseek/deepseek-v4-pro",
    name: "DeepSeek V4 Pro",
    contextLength: 1000000,
    inputModalities: ["text"],
    endpointTypes: ["openai"],
    reasoning: true,
  },
  {
    id: "orcarouter/auto",
    name: "OrcaRouter Auto",
    contextLength: 200000,
    inputModalities: ["text"],
    endpointTypes: ["openai"],
  },
];

/** The seed, filtered for the same entry point the caller asked for. */
export function seedCatalog(options = {}) {
  return filterCatalog(
    ORCAROUTER_SEED_MODELS.map((m) => normalizeCatalogEntry(m)),
    options
  );
}

// ── bounded live discovery ──────────────────────────────────────────────────

export const ORCAROUTER_CATALOG_LIMITS = {
  timeoutMs: 10000,
  maxBytes: 4 * 1024 * 1024,
  maxItems: 2000,
};

/** Read a response body while enforcing a hard byte ceiling. */
async function readBounded(res, maxBytes) {
  if (!res.body || typeof res.body.getReader !== "function") {
    const text = await res.text();
    return text.length > maxBytes ? text.slice(0, maxBytes) : text;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value?.byteLength || 0;
    out += decoder.decode(value, { stream: true });
    if (received > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        /* the ceiling is what matters, not the cancel acknowledgement */
      }
      break;
    }
  }
  return out;
}

function extractModelArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  for (const key of ["data", "models", "results"]) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  return [];
}

/**
 * Fetch the live catalog from the configured inference origin.
 *
 * Always resolves. On success the live result is authoritative; on any failure
 * the caller gets `source: "fallback"` plus the verified seed, so a fresh
 * install is never left with an empty picker.
 */
export async function discoverOrcaRouterModels({
  apiKey,
  apiBase,
  capability = "chat",
  modality = null,
  fetchImpl = globalThis.fetch,
  timeoutMs = ORCAROUTER_CATALOG_LIMITS.timeoutMs,
  maxBytes = ORCAROUTER_CATALOG_LIMITS.maxBytes,
  maxItems = ORCAROUTER_CATALOG_LIMITS.maxItems,
} = {}) {
  const base = normalizeBase(apiBase) || ORCAROUTER_API_BASE_DEFAULT;
  const fallback = () => ({
    ok: false,
    source: "fallback",
    degraded: true,
    models: seedCatalog({ capability, modality }),
  });

  if (!isAllowedOrcaOrigin(base)) return { ...fallback(), error: "insecure_or_origin" };
  if (!apiKey) return { ...fallback(), error: "missing_api_key" };
  if (typeof fetchImpl !== "function") return { ...fallback(), error: "no_fetch" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(
      buildCatalogUrl({ apiBase: base, capability: CAPABILITY_QUERY[capability] ?? capability }),
      {
        method: "GET",
        headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
      }
    );
    if (!res || !res.ok) {
      return { ...fallback(), error: `http_${res?.status ?? "unknown"}` };
    }

    const text = await readBounded(res, maxBytes);
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      return { ...fallback(), error: "invalid_json" };
    }

    const normalized = extractModelArray(payload)
      .slice(0, maxItems)
      .map(normalizeCatalogEntry)
      .filter(Boolean);

    if (!normalized.length) return { ...fallback(), error: "empty_catalog" };

    return {
      ok: true,
      source: "live",
      degraded: false,
      models: filterCatalog(normalized, { capability, modality }),
    };
  } catch (error) {
    return { ...fallback(), error: error?.name === "AbortError" ? "timeout" : "network_error" };
  } finally {
    clearTimeout(timer);
  }
}
