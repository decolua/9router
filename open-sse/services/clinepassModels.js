import { buildClineHeaders } from "../shared/clineAuth.js";

const CLINEPASS_MODELS_ENDPOINT = "https://api.cline.bot/api/v1/models";
const CLINE_PASS_ID_PREFIX = "cline-pass/";
const FETCH_TIMEOUT_MS = 5000;

/**
 * Build request headers for the ClinePass /models endpoint (Cline's upstream API).
 * - API keys are sent as plain Bearer tokens.
 * - OAuth access tokens must carry the WorkOS `workos:` prefix (handled by buildClineHeaders).
 */
function buildModelListHeaders(token, isApiKey) {
  if (isApiKey) {
    return {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    };
  }
  return buildClineHeaders(token, { Accept: "application/json" });
}

/**
 * Fetch the live model catalog from Cline's /models endpoint.
 * Cline and ClinePass share this upstream endpoint; `idFilter` decides which
 * side of the `cline-pass/` prefix split the caller owns.
 *
 * @param {object} credentials - Connection credentials ({ accessToken, apiKey })
 * @param {(id: string) => boolean} idFilter
 * @returns {Promise<{ models: { id: string, name: string }[] } | null>}
 */
async function fetchClineCatalog(credentials, idFilter) {
  const isApiKey = Boolean(credentials?.apiKey);
  const token = isApiKey ? credentials.apiKey : credentials?.accessToken;
  if (!token) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const headers = buildModelListHeaders(token, isApiKey);

    const response = await fetch(CLINEPASS_MODELS_ENDPOINT, {
      method: "GET",
      headers,
      signal: controller.signal,
    });

    if (!response.ok) return null;

    const json = await response.json();
    const rawList = Array.isArray(json) ? json : json?.data;
    if (!Array.isArray(rawList)) return null;

    const models = rawList
      .filter((m) => typeof m?.id === "string" && idFilter(m.id))
      .map((m) => ({
        id: m.id,
        name: m.name || m.id,
      }));

    return models.length ? { models } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * ClinePass live catalog — only `cline-pass/*` ids (billed via ClinePass).
 *
 * @param {object} credentials - Connection credentials ({ accessToken, apiKey })
 * @returns {Promise<{ models: { id: string, name: string }[] } | null>}
 */
export async function resolveClinepassModels(credentials) {
  return fetchClineCatalog(credentials, (id) => id.startsWith(CLINE_PASS_ID_PREFIX));
}

/**
 * Cline (regular OAuth/API-key) live catalog — excludes `cline-pass/*` ids,
 * which are valid/billable only for ClinePass connections.
 *
 * @param {object} credentials - Connection credentials ({ accessToken, apiKey })
 * @returns {Promise<{ models: { id: string, name: string }[] } | null>}
 */
export async function resolveClineModels(credentials) {
  return fetchClineCatalog(credentials, (id) => !id.startsWith(CLINE_PASS_ID_PREFIX));
}
