// Shared JSON-RPC handler for both transports (streamable-HTTP POST and SSE).
//
// Responsibilities:
//   1. Auth — validate the gateway API key, scope the request to the
//      caller's granted instances.
//   2. Dispatch — `initialize`, `notifications/initialized`, `tools/list`,
//      `tools/call`; anything else yields -32601.
//   3. Log each tools/call into the standard 9router usage pipeline so
//      gateway traffic appears in the existing /dashboard/usage view.

import { extractApiKey } from "@/shared/utils/extractApiKey";
import {
  validateGatewayKey,
  getGrantsForKeyDetailed,
  getEnabledInstancesByIds,
  saveRequestUsage,
} from "@/lib/localDb";
import { isToolAllowed, filterToolsByGrants } from "./grants.js";

const SERVER_INFO = { name: "9router-gateway", version: "1" };
const PROTOCOL_VERSION = "2025-06-18";

const SERVER_CAPABILITIES = { tools: { listChanged: false } };

function jsonRpcOk(id, result) {
  return { jsonrpc: "2.0", id, result };
}
function jsonRpcErr(id, code, message, data) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message, ...(data !== undefined ? { data } : {}) } };
}
async function authenticate(request) {
  const rawKey = extractApiKey(request);
  if (!rawKey) return { ok: false, reason: "missing" };
  const keyRow = await validateGatewayKey(rawKey);
  if (!keyRow) return { ok: false, reason: "invalid" };
  const grantsDetailed = await getGrantsForKeyDetailed(keyRow.id);
  const instances = await getEnabledInstancesByIds(grantsDetailed.map((g) => g.instanceId));
  // Join grants with instance slug so downstream filter helpers can
  // resolve a tool's `instanceSlug__bare` name to a grant.
  const grants = grantsDetailed.map((g) => ({
    instanceId: g.instanceId,
    slug: instances.find((i) => i.id === g.instanceId)?.slug || null,
    toolAllowlist: g.toolAllowlist,
  }));
  return { ok: true, rawKey, keyRow, instances, grants };
}

/**
 * Handle a parsed JSON-RPC request. Returns:
 *   { kind: "notification" }              — caller should 202
 *   { kind: "response", body: {...} }     — single JSON-RPC response
 *   { kind: "batch", items: [...] }       — batched (we don't batch but allow)
 */
export async function handleJsonRpc(request, body, opts = {}) {
  const auth = await authenticate(request);
  if (!auth.ok) {
    return { kind: "response", status: 401, body: jsonRpcErr(null, -32000, `gateway key ${auth.reason}`) };
  }
  const { rawKey, keyRow, instances, grants } = auth;

  const obj = body;
  if (!obj || obj.jsonrpc !== "2.0") {
    return { kind: "response", status: 400, body: jsonRpcErr(obj?.id ?? null, -32600, "invalid jsonrpc envelope") };
  }

  const respond = async (rpcBody) => {
    return { kind: "response", status: 200, body: rpcBody };
  };

  switch (obj.method) {
    case "initialize": {
      const result = {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: SERVER_CAPABILITIES,
        serverInfo: SERVER_INFO,
        instructions: opts.instructions || "9router MCP Gateway — tools are namespaced as <instanceSlug>__<toolName>",
      };
      return respond(jsonRpcOk(obj.id, result));
    }
    case "notifications/initialized":
      return { kind: "notification" };
    case "ping":
      return respond(jsonRpcOk(obj.id, {}));
    case "tools/list": {
      const { aggregateTools } = await import("./aggregator.js");
      const { tools, errors } = await aggregateTools(instances, grants);
      // Optional cursor pagination — most harnesses ignore.
      return respond(jsonRpcOk(obj.id, { tools, nextCursor: null, _gateway: { errors } }));
    }
    case "tools/call": {
      const params = obj.params || {};
      if (!params.name) {
        return respond(jsonRpcErr(obj.id, -32602, "tools/call requires params.name"));
      }
      // Resolve the target instance by slug prefix once; reuse for logging
      // on both success and error paths.
      const splitIdx = params.name.indexOf("__");
      const slug = splitIdx > 0 ? params.name.slice(0, splitIdx) : null;
      const instance = slug ? instances.find((i) => i.slug === slug) || null : null;
      if (!instance) {
        return respond(jsonRpcErr(obj.id, -32602, `unknown tool: ${params.name}`));
      }
      try {
        const { dispatchToolCall } = await import("./aggregator.js");
        const { result } = await dispatchToolCall(instances, grants, params.name, params.arguments || {});
        // Fire-and-forget log — never block the response on logging.
        saveRequestUsage({
          provider: "mcp-gateway",
          model: params.name,
          connectionId: instance.id,
          apiKey: rawKey,
          endpoint: "/api/mcp-gateway",
          tokens: {},
          status: "ok",
        }).catch((e) => console.warn("[mcp-gw] usage log failed:", e?.message));
        return respond(jsonRpcOk(obj.id, result ?? { content: [], isError: false }));
      } catch (e) {
        const errMsg = e?.message || String(e);
        const code = typeof e?.code === "number" ? e.code : -32603;
        const isUpstream = !e?.code;
        saveRequestUsage({
          provider: "mcp-gateway",
          model: params.name,
          connectionId: instance.id,
          apiKey: rawKey,
          endpoint: "/api/mcp-gateway",
          tokens: {},
          status: "error",
        }).catch(() => {});
        // Per MCP spec, errors that happen on the *upstream* should be
        // returned as a successful response with isError=true so the model
        // sees the failure as tool output, not a transport error.
        if (isUpstream) {
          return respond(jsonRpcOk(obj.id, {
            content: [{ type: "text", text: `tool error: ${errMsg}` }],
            isError: true,
          }));
        }
        return respond(jsonRpcErr(obj.id, code, errMsg));
      }
    }
    default:
      return respond(jsonRpcErr(obj.id, -32601, `method not implemented: ${obj.method}`));
  }
}

export const __test__ = { authenticate, SERVER_INFO, PROTOCOL_VERSION };
