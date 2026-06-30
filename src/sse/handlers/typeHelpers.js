function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toJsonValue(v) {
  if (v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
    return v;
  }
  if (Array.isArray(v)) {
    const arr = [];
    for (const item of v) {
      const mapped = toJsonValue(item);
      if (mapped !== undefined) arr.push(mapped);
    }
    return arr;
  }
  if (isRecord(v)) {
    const rec = {};
    for (const [k, vv] of Object.entries(v)) {
      const mapped = toJsonValue(vv);
      if (mapped !== undefined) rec[k] = mapped;
    }
    return rec;
  }
  return undefined;
}

function mapProviderSpecificData(data) {
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    out[k] = toJsonValue(v);
  }
  return out;
}

function mapRuntimeTransport(rt) {
  const out = {};
  let hasData = false;

  if (typeof rt.baseUrl === "string") { out.baseUrl = rt.baseUrl; hasData = true; }
  if (typeof rt.urlSuffix === "string") { out.urlSuffix = rt.urlSuffix; hasData = true; }

  if (isRecord(rt.headers)) {
    const headers = Object.fromEntries(
      Object.entries(rt.headers).filter(([, v]) => typeof v === "string"),
    );
    if (Object.keys(headers).length > 0) { out.headers = headers; hasData = true; }
  }

  if (isRecord(rt.auth)) {
    const auth = rt.auth;
    const mappedAuth = {
      combined: auth.combined === true,
      anthropicVersion: auth.anthropicVersion === true,
    };
    if (typeof auth.header === "string") mappedAuth.header = auth.header;
    if (typeof auth.scheme === "string") mappedAuth.scheme = auth.scheme;
    if (isRecord(auth.apiKey)) {
      mappedAuth.apiKey = {
        header: typeof auth.apiKey.header === "string" ? auth.apiKey.header : "",
        scheme: typeof auth.apiKey.scheme === "string" ? auth.apiKey.scheme : "",
      };
    }
    if (isRecord(auth.oauth)) {
      mappedAuth.oauth = {
        header: typeof auth.oauth.header === "string" ? auth.oauth.header : "",
        scheme: typeof auth.oauth.scheme === "string" ? auth.oauth.scheme : "",
      };
    }
    if (Array.isArray(auth.hooks)) {
      const hooks = auth.hooks.filter((h) => typeof h === "string");
      if (hooks.length > 0) mappedAuth.hooks = hooks;
    }
    out.auth = mappedAuth;
    hasData = true;
  }

  if (typeof rt.format === "string") { out.format = rt.format; hasData = true; }
  return hasData ? out : undefined;
}

/**
 * Convert a loose credential record (e.g. from getProviderCredentials) into the
 * ExecutorCredentials shape expected by open-sse core handlers. Unknown fields
 * are dropped; providerSpecificData is recursively mapped to JsonValue.
 *
 * @param {object} creds
 * @returns {object}
 */
export function toExecutorCredentials(creds) {
  const out = {};

  if (typeof creds.apiKey === "string") out.apiKey = creds.apiKey;
  if (typeof creds.accessToken === "string") out.accessToken = creds.accessToken;
  if (typeof creds.refreshToken === "string") out.refreshToken = creds.refreshToken;
  if (typeof creds.copilotToken === "string") out.copilotToken = creds.copilotToken;
  if (typeof creds.expiresAt === "string" || typeof creds.expiresAt === "number") out.expiresAt = creds.expiresAt;
  if (typeof creds.connectionName === "string") out.connectionName = creds.connectionName;
  if (typeof creds.connectionId === "string") out.connectionId = creds.connectionId;

  const rawHeaders = isRecord(creds.rawHeaders)
    ? Object.fromEntries(
        Object.entries(creds.rawHeaders).filter(([, v]) => typeof v === "string"),
      )
    : undefined;
  if (rawHeaders && Object.keys(rawHeaders).length > 0) out.rawHeaders = rawHeaders;

  if (isRecord(creds.providerSpecificData)) {
    out.providerSpecificData = mapProviderSpecificData(creds.providerSpecificData);
  }

  if (isRecord(creds.runtimeTransport)) {
    const mapped = mapRuntimeTransport(creds.runtimeTransport);
    if (mapped) out.runtimeTransport = mapped;
  }

  return out;
}

/**
 * Map a typed ExecutorResult into the normalized CoreResult shape used by SSE
 * handlers. Core handlers now return ExecutorResult directly, so this is a
 * narrow discriminator-driven mapping rather than a validation pass.
 *
 * @param {object} result
 * @param {string} fallbackError
 * @returns {object}
 */
export function toCoreResult(result, fallbackError) {
  if (result.success) {
    return {
      success: true,
      response: result.response,
      status: result.status,
      error: fallbackError,
      resetsAtMs: null,
    };
  }
  return {
    success: false,
    response: result.response,
    status: result.status,
    error: result.error,
    resetsAtMs: result.resetsAtMs ?? null,
  };
}
