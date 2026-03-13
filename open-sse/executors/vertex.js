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
    const projectId = saJson?.project_id || "unknown";

    if (this.provider === "vertex-partner") {
      const modelFamily = credentials?.providerSpecificData?.modelFamily || "openai";


      if (modelFamily === "anthropic") {
        // Anthropic Claude on Vertex: rawPredict endpoint
        const base = `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/publishers/anthropic/models`;
        return `${base}/${model}:${stream ? "streamRawPredict" : "rawPredict"}`;
      }

      // All other partner models (Llama, Mistral, GLM-5, etc.) use the global OpenAI-compatible endpoint
      return `https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/global/endpoints/openapi/chat/completions`;
    }

    // Default: Gemini models on Vertex (cannot use "global" region)
    if (region === "global") region = "us-central1";
    const base = `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/publishers/google/models`;
    return `${base}/${model}:${stream ? "streamGenerateContent?alt=sse" : "generateContent"}`;
  }

  async _buildHeadersAsync(credentials, stream = true) {
    const headers = { "Content-Type": "application/json" };

    const saJson = parseSaJson(credentials?.apiKey);
    if (saJson) {
      const token = await mintVertexToken(saJson);
      headers["Authorization"] = `Bearer ${token}`;
    }

    if (stream) headers["Accept"] = "text/event-stream";

    return headers;
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
