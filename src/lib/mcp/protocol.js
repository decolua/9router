import { createHash } from "node:crypto";

/**
 * MCP wire protocol helpers.
 *
 * Single source of truth for supported protocol versions, negotiation, and
 * session-owner derivation. Keep the supported version list aligned with the
 * upstream MCP TypeScript SDK rather than duplicating literals across routes.
 */

export const LATEST_PROTOCOL_VERSION = "2025-11-25";
export const DEFAULT_NEGOTIATED_PROTOCOL_VERSION = "2025-03-26";
export const SUPPORTED_PROTOCOL_VERSIONS = [
  LATEST_PROTOCOL_VERSION,
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
  "2024-10-07",
];

/**
 * Maximum messages accepted in a single JSON-RPC batch.
 *
 * Guards against amplification — one POST would otherwise fan out unbounded
 * upstream calls (the rate limiter counts requests, not messages). JSON-RPC
 * batch support was removed in protocol 2025-06-18; this remains for older
 * clients.
 */
export const MAX_BATCH_SIZE = 50;

export function isSupportedProtocolVersion(version) {
  return SUPPORTED_PROTOCOL_VERSIONS.includes(version);
}

/**
 * Negotiate the protocol version for an `initialize` response. Echo the
 * client's version when supported; otherwise fall back to the default
 * negotiated version per the MCP lifecycle spec.
 */
export function negotiateProtocolVersion(clientVersion) {
  if (clientVersion && SUPPORTED_PROTOCOL_VERSIONS.includes(clientVersion)) {
    return clientVersion;
  }
  return DEFAULT_NEGOTIATED_PROTOCOL_VERSION;
}

/**
 * Derive a stable, non-reversible owner id from an API key/token so gateway
 * SSE sessions can be bound to the key that created them, without keeping the
 * raw secret in memory. Used to reject cross-key session access/termination.
 */
export function deriveSessionOwner(token) {
  if (!token) return null;
  return createHash("sha256").update(String(token)).digest("hex");
}
