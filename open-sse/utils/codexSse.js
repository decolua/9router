import { CODEX_IMAGE_ERROR_TEXT_LIMIT } from "../config/codexConstants.js";

export function isCodexClientVersionError(message) {
  return /requires a newer version of Codex/i.test(String(message || ""));
}

export function isCodexModelAccessError(status, message) {
  return [400, 404].includes(Number(status)) &&
    /model_not_found|model.{0,200}(?:does not exist|not found|not supported|do not have access)/i.test(String(message || ""));
}

// HTTP 200 can still contain a failed Responses API event.
export function codexEventError(event, data) {
  if (event !== "error" && event !== "response.failed" && event !== "response.incomplete" &&
      !["failed", "incomplete"].includes(data?.response?.status)) return null;
  const detail = data?.response?.error || data?.error;
  const message = detail?.message || (typeof detail === "string" ? detail : null) ||
    data?.message || data?.response?.incomplete_details?.reason || "Codex response failed.";
  const error = new Error(String(message).slice(0, CODEX_IMAGE_ERROR_TEXT_LIMIT));
  error.code = typeof detail?.code === "string" ? detail.code : undefined;
  const explicitStatus = Number(detail?.status_code || data?.status_code);
  error.statusCode = Number.isInteger(explicitStatus) && explicitStatus >= 400 && explicitStatus <= 599 ? explicitStatus :
    error.code === "model_not_found" ? 404 :
    ["rate_limit_exceeded", "usage_limit_reached"].includes(error.code) ? 429 :
    error.code === "invalid_api_key" ? 401 :
    isCodexClientVersionError(error.message) ? 400 : 502;
  return error;
}

// Incremental SSE framing shared by images and quota pings. Accept data-only events,
// CRLF and an EOF without a blank separator, including split UTF-8 sequences.
export async function* readCodexEvents(response, signal) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;
  let bytesReceived = 0;
  const cancel = () => { reader.cancel().catch(() => {}); };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    while (!finished) {
      if (signal?.aborted) return;
      const { done, value } = await reader.read();
      finished = done;
      bytesReceived += value?.byteLength || 0;
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let separator;
      while ((separator = /\r\n\r\n|\n\n|\r\r/.exec(buffer)) || (done && buffer)) {
        const block = separator ? buffer.slice(0, separator.index) : buffer;
        buffer = separator ? buffer.slice(separator.index + separator[0].length) : "";
        let event = null;
        const lines = [];
        for (const line of block.split(/\r\n|\n|\r/)) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) lines.push(line.slice(5).trimStart());
        }
        let data;
        try { data = JSON.parse(lines.join("\n")); } catch { /* Ignore keepalives and malformed frames. */ }
        event ||= data?.type;
        if (event) yield { event, data, bytesReceived };
      }
    }
  } finally {
    signal?.removeEventListener("abort", cancel);
    if (!finished) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
