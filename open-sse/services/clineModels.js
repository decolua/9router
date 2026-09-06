import { buildClineHeaders } from "../shared/clineAuth.js";

const CLINE_MODELS_ENDPOINT = "https://api.cline.bot/api/v1/models";
const FETCH_TIMEOUT_MS = 5000;

/**
 * Build request headers for the free Cline /models endpoint (Cline's upstream API).
 * Free Cline connections authenticate with the WorkOS-prefixed OAuth token
 * (handled by buildClineHeaders).
 */
function buildModelListHeaders(token) {
  return buildClineHeaders(token, { Accept: "application/json" });
}

/**
 * Fetch the live model catalog from Cline's /models endpoint for a free
 * (OAuth) Cline connection. ClinePass models are served from the same
 * endpoint but belong to the separate `clinepass` provider, so anything
 * under the `cline-pass/` prefix is filtered out here.
 *
 * @param {object} credentials - Connection credentials ({ accessToken })
 * @returns {Promise<{ models: { id: string, name: string }[] } | null>}
 */
export async function resolveClineModels(credentials) {
  const token = credentials?.accessToken;
  if (!token) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(CLINE_MODELS_ENDPOINT, {
      method: "GET",
      headers: buildModelListHeaders(token),
      signal: controller.signal,
    });

    if (!response.ok) return null;

    const json = await response.json();
    const rawList = Array.isArray(json) ? json : json?.data;
    if (!Array.isArray(rawList)) return null;

    const models = rawList
      .filter((m) => typeof m?.id === "string" && m.id !== "" && !m.id.startsWith("cline-pass/"))
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
