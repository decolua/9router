import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { GoogleAuth } from "google-auth-library";

/**
 * VertexExecutor - Google Cloud Vertex AI via Service Account JSON credentials.
 *
 * Supports two provider IDs:
 *
 *   "vertex"         → Gemini models hosted on Vertex AI
 *                      Endpoint: {region}-aiplatform.googleapis.com/v1/projects/{project}/
 *                                locations/{region}/publishers/google/models/{model}:streamGenerateContent
 *                      Format translator: "gemini"
 *
 *   "vertex-partner" → Partner models (Anthropic Claude, Meta Llama, Mistral, GLM-5, etc.)
 *                      Endpoint: aiplatform.googleapis.com/v1/projects/{project}/
 *                                locations/global/endpoints/openapi/chat/completions
 *                      Format translator: "openai" (OpenAI-compatible endpoint)
 *                      For Anthropic Claude on Vertex:
 *                      Endpoint: {region}-aiplatform.googleapis.com/v1/projects/{project}/
 *                                locations/{region}/publishers/anthropic/models/{model}:streamRawPredict
 *
 * Auth flow (both):
 *   SA JSON (stored as apiKey) → GoogleAuth → short-lived Bearer token → Authorization header
 *   google-auth-library handles token caching and expiry automatically.
 *
 * Connection providerSpecificData:
 *   { region: "us-central1" }                           (vertex)
 *   { region: "us-east5", modelFamily: "openai" }       (vertex-partner, default)
 *   { region: "us-east1", modelFamily: "anthropic" }    (vertex-partner, Anthropic Claude)
 */

// Cache GoogleAuth instances keyed by service account email to avoid re-creating per request
const authCache = new Map();

function getGoogleAuth(saJson) {
  const key = saJson.client_email;
  if (authCache.has(key)) return authCache.get(key);

  const auth = new GoogleAuth({
    credentials: {
      client_email: saJson.client_email,
      private_key: saJson.private_key.replace(/\\n/g, '\n'),
      project_id: saJson.project_id,
    },
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });

  authCache.set(key, auth);
  return auth;
}

export function parseSaJson(apiKey) {
  if (typeof apiKey !== "string") return null;
  try {
    const parsed = JSON.parse(apiKey);
    if (parsed.type === "service_account" && parsed.client_email && parsed.private_key && parsed.project_id) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export async function mintVertexToken(saJson) {
  const auth = getGoogleAuth(saJson);
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  const token = tokenResponse?.token ?? tokenResponse?.access_token ?? (typeof tokenResponse === "string" ? tokenResponse : null);
  if (!token) throw new Error("Failed to mint Vertex AI access token");
  return token;
}

export class VertexExecutor extends BaseExecutor {
  constructor(providerId = "vertex") {
    super(providerId, PROVIDERS[providerId] || {});
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    const saJson = parseSaJson(credentials?.apiKey);
    let region = credentials?.providerSpecificData?.region || "us-central1";
    const projectId = saJson?.project_id || credentials?.providerSpecificData?.projectId;

    if (this.provider === "vertex-partner") {
      const modelFamily = credentials?.providerSpecificData?.modelFamily || "openai";

      if (modelFamily === "anthropic") {
        if (!projectId) throw new Error("Anthropic on Vertex requires a project_id (via Service Account JSON).");
        const base = `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/publishers/anthropic/models`;
        let url = `${base}/${model}:${stream ? "streamRawPredict" : "rawPredict"}`;
        if (!saJson && credentials?.apiKey) url += `?key=${credentials.apiKey}`;
        return url;
      }

      // All other partner models (Llama, Mistral, GLM-5, etc.) use the global OpenAI-compatible endpoint
      if (!projectId) throw new Error("Partner models on Vertex require a project_id (via Service Account JSON).");
      let url = `https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/global/endpoints/openapi/chat/completions`;
      if (!saJson && credentials?.apiKey) url += `?key=${credentials.apiKey}`;
      return url;
    }

    // Default: Gemini models on Vertex
    let url;
    if (region === "global" || !projectId) {
      // Global endpoint (no project_id or location path)
      const base = `https://aiplatform.googleapis.com/v1/publishers/google/models`;
      url = `${base}/${model}:${stream ? "streamGenerateContent?alt=sse" : "generateContent"}`;
    } else {
      // Regional endpoint
      const base = `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/publishers/google/models`;
      url = `${base}/${model}:${stream ? "streamGenerateContent?alt=sse" : "generateContent"}`;
    }

    // If using a raw API key (not SA JSON), we can pass it via ?key= (some Vertex proxy endpoints require this)
    if (!saJson && credentials?.apiKey) {
      url += (url.includes("?") ? "&" : "?") + `key=${credentials.apiKey}`;
    }

    return url;
  }

  async _buildHeadersAsync(credentials, stream = true) {
    const headers = { "Content-Type": "application/json" };

    const saJson = parseSaJson(credentials?.apiKey);
    if (saJson) {
      // Service Account JSON → mint a short-lived OAuth Bearer token
      const token = await mintVertexToken(saJson);
      headers["Authorization"] = `Bearer ${token}`;
    }
    // Raw API key: already appended as ?key= in buildUrl.
    // Do NOT set Authorization header — Google's global endpoint rejects
    // raw keys as Bearer tokens and returns 401.

    if (stream) headers["Accept"] = "text/event-stream";

    return headers;
  }

  // No-op: Vertex uses short-lived tokens minted per-request (SA JSON) or static ?key=.
  // Returning null prevents chatCore.js from entering the 3-retry refreshWithRetry loop on 401.
  async refreshCredentials(_credentials, _log) {
    return null;
  }

  // Override execute to handle async auth token minting
  async execute({ model, body, stream, credentials, signal, log }) {
    const url = this.buildUrl(model, stream, 0, credentials);
    const headers = await this._buildHeadersAsync(credentials, stream);
    const transformedBody = this.transformRequest(model, body, stream, credentials);

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(transformedBody),
      signal,
    });

    return { response, url, headers, transformedBody };
  }
}

export default VertexExecutor;
