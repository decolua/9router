const decoderOptions = { fatal: false };

function textValue(value) {
  if (typeof value === "string") return value;
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(textValue).filter(Boolean).join("");
  return "";
}

function readAssistantText(payload) {
  const choice = payload?.choices?.[0];
  return [
    choice?.delta?.content,
    choice?.message?.content,
    payload?.output_text,
    payload?.text,
    payload?.delta?.text,
  ].map(textValue).find(Boolean) || "";
}

function normalizeUsage(usage) {
  if (!usage || typeof usage !== "object") return null;
  const inputTokens = usage.prompt_tokens ?? usage.input_tokens;
  const outputTokens = usage.completion_tokens ?? usage.output_tokens;
  const totalTokens = usage.total_tokens ?? usage.totalTokens;
  const normalized = {};

  if (Number.isFinite(inputTokens)) normalized.inputTokens = inputTokens;
  if (Number.isFinite(outputTokens)) normalized.outputTokens = outputTokens;
  if (Number.isFinite(totalTokens)) normalized.totalTokens = totalTokens;

  return Object.keys(normalized).length > 0 ? normalized : null;
}

function readErrorMessage(payload) {
  const error = payload?.error ?? payload;
  if (typeof error === "string") return error;
  if (typeof error?.message === "string") return error.message;
  return "Stream error";
}

function parseFrame(frame, eventName) {
  const data = frame
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).replace(/^ /, ""))
    .join("\n");

  if (!data) return [];
  if (data === "[DONE]") return [{ type: "done" }];

  let payload;
  try {
    payload = JSON.parse(data);
  } catch {
    return [{ type: "malformed", raw: data }];
  }

  const events = [];
  const text = readAssistantText(payload);
  if (text) events.push({ type: "delta", text });

  const usage = normalizeUsage(payload.usage ?? (eventName === "usage" ? payload : null));
  if (usage) events.push({ type: "usage", usage });

  if (eventName === "error" || payload?.error) {
    events.push({ type: "error", message: readErrorMessage(payload) });
  }

  return events;
}

/**
 * Incrementally parses browser-visible SSE bytes into Playground stream events.
 * The instance owns decoder and framing state, so a single instance must serve
 * one response reader from dispatch until it closes.
 */
export function createSseParser() {
  const decoder = new TextDecoder("utf-8", decoderOptions);
  let buffer = "";
  let currentEventName = "";
  let terminalSeen = false;

  const parseAvailableFrames = () => {
    const events = [];
    const frames = buffer.split(/\n\n/);
    buffer = frames.pop() || "";

    for (const frame of frames) {
      if (terminalSeen) break;
      const eventLine = frame.split("\n").find((line) => line.startsWith("event:"));
      const eventName = eventLine ? eventLine.slice(6).trim() : currentEventName;
      const frameEvents = parseFrame(frame, eventName);
      events.push(...frameEvents);
      currentEventName = "";
      if (frameEvents.some((event) => event.type === "done" || event.type === "error")) {
        terminalSeen = true;
      }
    }

    return events;
  };

  return {
    push(chunk) {
      if (terminalSeen) return [];
      buffer += decoder.decode(chunk, { stream: true }).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      return parseAvailableFrames();
    },

    close() {
      if (terminalSeen) return null;
      buffer += decoder.decode().replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      const trailingEvents = parseAvailableFrames();
      if (trailingEvents.some((event) => event.type === "done" || event.type === "error")) return null;
      return { type: "incomplete" };
    },
  };
}
