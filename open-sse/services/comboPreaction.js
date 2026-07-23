import { getComboPreactionConfig } from "../config/runtimeConfig.js";

function parseFrame(frame) {
  let event = "";
  const data = [];
  for (const line of frame.split(/\r\n|\n|\r/)) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  if (data.length === 0 || data.join("\n") === "[DONE]") return null;
  try {
    const payload = JSON.parse(data.join("\n"));
    return { event: event || payload?.type || "", payload };
  } catch {
    return null;
  }
}

function isAction(frame) {
  const { event = "", payload } = frame || {};
  if ((event === "response.output_text.delta" || event === "response.refusal.delta") && payload?.delta) return true;
  if (event === "response.output_item.added" && ["function_call", "custom_tool_call"].includes(payload?.item?.type)) return true;
  if (event === "content_block_start" && payload?.content_block?.type === "tool_use") return true;
  if (event === "content_block_delta" && (
    (payload?.delta?.type === "text_delta" && payload.delta.text)
    || (payload?.delta?.type === "input_json_delta" && payload.delta.partial_json)
  )) return true;
  return payload?.choices?.some((choice) => (
    (typeof choice?.delta?.content === "string" && choice.delta.content.length > 0)
    || (Array.isArray(choice?.delta?.tool_calls) && choice.delta.tool_calls.length > 0)
  )) === true;
}

function scanFrames(buffer) {
  const separator = /\r\n\r\n|\n\n|\r\r/g;
  let start = 0;
  let actionable = false;
  for (let match = separator.exec(buffer); match; match = separator.exec(buffer)) {
    actionable ||= isAction(parseFrame(buffer.slice(start, match.index)));
    start = match.index + match[0].length;
  }
  return { actionable, remainder: buffer.slice(start) };
}

function committedResponse(response, reader, prefix) {
  let finished = false;
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of prefix) controller.enqueue(chunk);
    },
    async pull(controller) {
      if (finished) return;
      try {
        const { done, value } = await reader.read();
        if (done) {
          finished = true;
          controller.close();
        } else {
          controller.enqueue(value);
        }
      } catch (error) {
        finished = true;
        controller.error(error);
      }
    },
    async cancel(reason) {
      finished = true;
      await reader.cancel(reason);
    },
  }), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

export async function inspectComboPreaction(response) {
  if (!response?.body || !response.headers.get("content-type")?.toLowerCase().includes("text/event-stream")) {
    return response;
  }

  const { firstActionTimeoutMs, maxBytes } = getComboPreactionConfig();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const prefix = [];
  let bytes = 0;
  let text = "";
  let timeoutId;
  const timeout = new Promise((resolve) => {
    timeoutId = setTimeout(() => resolve({ timedOut: true }), firstActionTimeoutMs);
  });

  try {
    while (true) {
      const result = await Promise.race([reader.read(), timeout]);
      if (result.timedOut) {
        await reader.cancel("combo first-action timeout").catch(() => {});
        return null;
      }
      if (result.done) {
        await reader.cancel("combo response ended before first action").catch(() => {});
        return null;
      }

      prefix.push(result.value);
      bytes += result.value.byteLength;
      text += decoder.decode(result.value, { stream: true });
      const scanned = scanFrames(text);
      text = scanned.remainder;
      if (scanned.actionable) return committedResponse(response, reader, prefix);
      if (bytes > maxBytes) {
        await reader.cancel("combo pre-action byte limit").catch(() => {});
        return null;
      }
    }
  } catch {
    await reader.cancel("combo pre-action read failed").catch(() => {});
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}
