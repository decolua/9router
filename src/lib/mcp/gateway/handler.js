// Shared JSON-RPC handler for both transports (streamable-HTTP POST and SSE).

import {
  validateGatewayKey,
  getGrantsForKeyDetailed,
  getEnabledInstancesByIds,
  saveRequestUsage,
} from "@/lib/localDb";
import { isRecord } from "./guards";

const SERVER_INFO = { name: "9router-gateway", version: "1" };
const PROTOCOL_VERSION = "2025-06-18";
const SERVER_CAPABILITIES = { tools: { listChanged: false } };

function extractApiKey(request) {
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) return authHeader.slice(7);

  const xApiKey = request.headers.get("x-api-key");
  if (xApiKey) return xApiKey;

  const googleApiKey = request.headers.get("x-goog-api-key");
  if (googleApiKey) return googleApiKey;

  try {
    return new URL(request.url).searchParams.get("key") || null;
  } catch {
    return null;
  }
}

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
  const grants = grantsDetailed.map((g) => ({
    instanceId: g.instanceId,
    slug: instances.find((i) => i.id === g.instanceId)?.slug || null,
    toolAllowlist: g.toolAllowlist,
  }));
  return { ok: true, rawKey, keyRow, instances, grants };
}

/**
 * Handle a parsed JSON-RPC request.
 * @param {Request} request
 * @param {unknown} body
 * @param {object} [opts]
 * @returns {Promise<{kind: "notification"} | {kind: "response", status: number, body: object}>}
 */
export async function handleJsonRpc(request, body, opts = {}) {
  const auth = await authenticate(request);
  if (!auth.ok) {
    return { kind: "response", status: 401, body: jsonRpcErr(null, -32000, `gateway key ${auth.reason}`) };
  }
  const { rawKey, instances, grants } = auth;

  const obj = body;
  if (!obj || obj.jsonrpc !== "2.0") {
    return { kind: "response", status: 400, body: jsonRpcErr(obj?.id ?? null, -32600, "invalid jsonrpc envelope") };
  }

  const respond = async (rpcBody) => ({ kind: "response", status: 200, body: rpcBody });

  switch (obj.method) {
    case "initialize": {
      const result = {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: SERVER_CAPABILITIES,
        serverInfo: SERVER_INFO,
        instructions: opts.instructions || "9Router MCP Gateway — tools are namespaced as <instanceSlug>__<toolName>",
      };
      return respond(jsonRpcOk(obj.id, result));
    }
    case "notifications/initialized":
      return { kind: "notification" };
    case "ping":
      return respond(jsonRpcOk(obj.id, {}));
    case "tools/list": {
      const { aggregateTools } = await import("./aggregator");
      const { tools, errors } = await aggregateTools(instances, grants);
      return respond(jsonRpcOk(obj.id, { tools, nextCursor: null, _gateway: { errors } }));
    }
    case "tools/call": {
      const params = isRecord(obj.params) ? obj.params : {};
      if (typeof params.name !== "string" || !params.name) {
        return respond(jsonRpcErr(obj.id, -32602, "tools/call requires params.name"));
      }
      const toolName = params.name;
      const splitIdx = toolName.indexOf("__");
      const slug = splitIdx > 0 ? toolName.slice(0, splitIdx) : null;
      const instance = slug ? instances.find((i) => i.slug === slug) || null : null;
      if (!instance) {
        return respond(jsonRpcErr(obj.id, -32602, `unknown tool: ${toolName}`));
      }
      try {
        const { dispatchToolCall } = await import("./aggregator");
        const args = isRecord(params.arguments) ? params.arguments : {};
        const { result } = await dispatchToolCall(instances, grants, toolName, args);
        saveRequestUsage({
          provider: "mcp-gateway",
          model: toolName,
          connectionId: instance.id,
          apiKey: rawKey,
          endpoint: "/api/mcp-gateway",
          tokens: {},
          status: "ok",
        }).catch((e) => console.warn("[mcp-gw] usage log failed:", e?.message));
        return respond(jsonRpcOk(obj.id, result ?? { content: [], isError: false }));
      } catch (e) {
        const errMsg = (typeof e.message === "string" ? e.message : undefined) || String(e);
        const code = typeof e.code === "number" ? e.code : -32603;
        const isUpstream = !e.code;
        saveRequestUsage({
          provider: "mcp-gateway",
          model: toolName,
          connectionId: instance.id,
          apiKey: rawKey,
          endpoint: "/api/mcp-gateway",
          tokens: {},
          status: "error",
        }).catch(() => {});
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
      return respond(jsonRpcErr(obj.id, -32601, `method not implemented: ${String(obj.method)}`));
  }
}

export const __test__ = { authenticate, SERVER_INFO, PROTOCOL_VERSION };
