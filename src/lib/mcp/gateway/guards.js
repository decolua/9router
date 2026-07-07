// Boundary-parser guards for JSON-RPC / MCP payloads.

/**
 * @param {unknown} x
 * @returns {x is Record<string, unknown>}
 */
export function isRecord(x) {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/**
 * @param {unknown} x
 * @returns {boolean}
 */
export function isJsonRpcRequest(x) {
  if (!isRecord(x)) return false;
  if (x.jsonrpc !== "2.0") return false;
  return typeof x.method === "string";
}

/**
 * @param {unknown} x
 * @returns {boolean}
 */
export function isJsonRpcResponse(x) {
  if (!isRecord(x)) return false;
  if (x.jsonrpc !== "2.0") return false;
  const hasResult = "result" in x;
  const hasError = "error" in x;
  return hasResult !== hasError;
}

/**
 * @param {unknown} x
 * @returns {boolean}
 */
export function isJsonRpcErrorResponse(x) {
  return isJsonRpcResponse(x) && "error" in x && isRecord(x.error);
}
