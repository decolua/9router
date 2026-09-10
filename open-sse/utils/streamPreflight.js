import { FORMATS } from "../translator/formats.js";

const DEFAULT_MAX_BYTES = 64 * 1024;

export class StreamPreflightError extends Error {
  constructor(message, { status = 502, code = "stream_preflight_failed" } = {}) {
    super(message);
    this.name = "StreamPreflightError";
    this.status = status;
    this.code = code;
  }
}

function findEventEnd(text, start = 0) {
  const lf = text.indexOf("\n\n", start);
  const crlf = text.indexOf("\r\n\r\n", start);
  if (lf === -1) return crlf === -1 ? null : { index: crlf, length: 4 };
  if (crlf === -1) return { index: lf, length: 2 };
  return lf < crlf ? { index: lf, length: 2 } : { index: crlf, length: 4 };
}

function parseSSEEvent(eventText) {
  let eventName = "message";
  const dataLines = [];
  let meaningful = false;

  for (const rawLine of eventText.split(/\r?\n/)) {
    if (!rawLine || rawLine.startsWith(":")) continue;
    meaningful = true;
    const colon = rawLine.indexOf(":");
    const field = colon === -1 ? rawLine : rawLine.slice(0, colon);
    let value = colon === -1 ? "" : rawLine.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") eventName = value;
    else if (field === "data") dataLines.push(value);
  }

  if (!meaningful) return null;
  if (dataLines.length === 0) {
    throw new StreamPreflightError("upstream SSE first event has no data");
  }

  let data;
  try {
    data = JSON.parse(dataLines.join("\n"));
  } catch {
    throw new StreamPreflightError("upstream SSE first event contains malformed JSON");
  }

  if (eventName === "error" || data?.type === "error") {
    throw new StreamPreflightError(data?.error?.message || data?.message || "upstream returned an SSE error before message_start");
  }
  // Anthropic may emit heartbeat/ping events before message_start. These are
  // benign — keep scanning rather than treating them as a malformed first event.
  if (eventName === "ping" || data?.type === "ping") return false;
  if (eventName !== "message_start" || data?.type !== "message_start") {
    throw new StreamPreflightError(`upstream SSE first event is ${eventName || data?.type || "unknown"}, expected message_start`);
  }
  return true;
}

function replayBuffered(reader, chunks) {
  let index = 0;
  return new ReadableStream({
    async pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(chunks[index++]);
        return;
      }
      try {
        const { done, value } = await reader.read();
        if (done) controller.close();
        else controller.enqueue(value);
      } catch (error) {
        controller.error(error);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    }
  });
}

async function readWithTimeout(reader, remainingMs, configuredTimeoutMs) {
  if (remainingMs <= 0) {
    throw new StreamPreflightError(
      `stream produced no valid first output within ${configuredTimeoutMs}ms`,
      { status: 504, code: "stream_preflight_timeout" }
    );
  }
  let timer;
  try {
    return await Promise.race([
      reader.read(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new StreamPreflightError(
          `stream produced no valid first output within ${configuredTimeoutMs}ms`,
          { status: 504, code: "stream_preflight_timeout" }
        )), remainingMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Validate only enough transformed output to establish a safe success boundary.
 * Buffered Uint8Array chunks are replayed byte-for-byte before the unread tail.
 */
export async function preflightTransformedStream(readable, sourceFormat, {
  timeoutMs,
  maxBytes = DEFAULT_MAX_BYTES
} = {}) {
  if (!readable) throw new StreamPreflightError("upstream returned an empty stream");

  const reader = readable.getReader();
  const chunks = [];
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let text = "";
  let scanStart = 0;
  let totalBytes = 0;
  const deadline = timeoutMs ? Date.now() + timeoutMs : null;

  try {
    while (true) {
      const read = deadline ? await readWithTimeout(reader, deadline - Date.now(), timeoutMs) : await reader.read();
      if (read.done) throw new StreamPreflightError("upstream stream ended before valid first output");

      const chunk = read.value instanceof Uint8Array ? read.value : new Uint8Array(read.value);
      chunks.push(chunk);
      totalBytes += chunk.byteLength;
      if (totalBytes > maxBytes) {
        throw new StreamPreflightError(`stream preflight exceeded ${maxBytes} bytes before valid first output`);
      }

      const decoded = decoder.decode(chunk, { stream: true });
      if (sourceFormat !== FORMATS.CLAUDE) {
        if (decoded.trim().length > 0) return replayBuffered(reader, chunks);
        continue;
      }

      text += decoded;
      while (true) {
        const end = findEventEnd(text, scanStart);
        if (!end) break;
        const eventText = text.slice(scanStart, end.index);
        scanStart = end.index + end.length;
        if (parseSSEEvent(eventText)) return replayBuffered(reader, chunks);
      }
    }
  } catch (error) {
    try { await reader.cancel(error); } catch { /* best-effort upstream cleanup */ }
    throw error instanceof StreamPreflightError
      ? error
      : new StreamPreflightError(error?.message || "stream preflight failed");
  }
}
