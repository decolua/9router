/**
 * Request body cloning helpers.
 *
 * Several stages in the chat pipeline mutate the request body in place:
 *   - translateRequest() runs stripContentTypes/ensureToolCallIds/fixMissingToolResponses
 *   - RTK compressMessages() rewrites tool_result text
 *   - injectCaveman() pushes into messages/system
 *
 * When a request can be dispatched more than once for the SAME logical turn
 * (combo model fallback, multi-account fallback), each attempt must start from
 * a pristine body. Otherwise attempt N+1 inherits the mutations of attempt N
 * (e.g. injected tool_results, compressed content, stripped fields), which can
 * corrupt tool_use/tool_call_id continuity for coding agents.
 *
 * Cloning at the single dispatch choke point (handleChatCore) isolates every
 * attempt with exactly one clone per dispatch and keeps the caller's object
 * (and clientRawRequest.body used for logging) pristine.
 */

/**
 * Deep-clone a request body. Bodies originate from JSON, so they are always
 * structured-clone/JSON safe. Falls back gracefully if cloning is unavailable.
 *
 * @template T
 * @param {T} body
 * @returns {T}
 */
export function cloneRequestBody(body) {
  if (body == null || typeof body !== "object") return body;

  try {
    if (typeof structuredClone === "function") {
      return structuredClone(body);
    }
  } catch {
    // Fall through to JSON clone (e.g. non-cloneable values present)
  }

  try {
    return JSON.parse(JSON.stringify(body));
  } catch {
    // Last resort: shallow copy. Better than throwing on the request path.
    return Array.isArray(body) ? [...body] : { ...body };
  }
}
