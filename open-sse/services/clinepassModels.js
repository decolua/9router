import { buildClineHeaders } from "../shared/clineAuth.js";

const CLINEPASS_MODELS_ENDPOINT = "https://api.cline.bot/api/v1/models";
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
 * Internal: fetch the raw model list from Cline's /models endpoint.
 * Returns the parsed array or null on any failure.
 */
async function fetchClineRawModels(credentials) {
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
    return Array.isArray(rawList) ? rawList : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch ClinePass live model catalog from Cline's /models endpoint.
 * Returns only models with the cline-pass/ prefix.
 *
 * @param {object} credentials - Connection credentials ({ accessToken, apiKey })
 * @returns {Promise<{ models: { id: string, name: string }[] } | null>}
 */
export async function resolveClinepassModels(credentials) {
  const rawList = await fetchClineRawModels(credentials);
  if (!rawList) return null;

  const models = rawList
    .filter((m) => typeof m?.id === "string" && m.id.startsWith("cline-pass/"))
    .map((m) => ({
      id: m.id,
      name: m.name || m.id,
    }));

  return models.length ? { models } : null;
}

/**
 * Fetch Cline live model catalog from Cline's /models endpoint.
 * Unlike resolveClinepassModels, this returns ALL models (including
 * free-tier models like z-ai/glm-5.3-flash) without the cline-pass/ prefix filter.
 *
 * @param {object} credentials - Connection credentials ({ accessToken, apiKey })
 * @returns {Promise<{ models: { id: string, name: string }[] } | null>}
 */
export async function resolveClineModels(credentials) {
  const rawList = await fetchClineRawModels(credentials);
  if (!rawList) return null;

  const models = rawList
    .filter((m) => typeof m?.id === "string" && m.id.trim() !== "")
    .map((m) => ({
      id: m.id,
      name: m.name || m.id,
    }));

  return models.length ? { models } : null;
}
