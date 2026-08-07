// Dynamic client registration (RFC 7591) for upstream MCP OAuth.

import { isRecord } from "./guards";

const TIMEOUT_MS = 10_000;

/**
 * Register a public OAuth client with the upstream authorization server.
 * @param {string | null | undefined} registrationEndpoint
 * @param {string} redirectUri
 * @param {object} [opts]
 * @returns {Promise<{clientId: string, clientSecret: string | null, clientIdIssuedAt: number}>}
 */
export async function registerClient(registrationEndpoint, redirectUri, opts = {}) {
  if (!registrationEndpoint) {
    throw new Error("no registration_endpoint available");
  }
  const body = {
    client_name: opts.clientName || "9router-mcp-gateway",
    redirect_uris: [redirectUri],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(registrationEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`registration ${res.status}: ${text?.slice(0, 200)}`);
    }
    const doc = await res.json().catch(() => null);
    if (!isRecord(doc) || !doc.client_id) {
      throw new Error("registration response missing client_id");
    }
    return {
      clientId: String(doc.client_id),
      clientSecret: doc.client_secret ? String(doc.client_secret) : null,
      clientIdIssuedAt: doc.client_id_issued_at || Date.now(),
    };
  } finally {
    clearTimeout(timer);
  }
}
