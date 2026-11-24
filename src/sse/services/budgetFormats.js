import { BUDGET_ENDPOINT } from "@/shared/utils/keyBudget.js";
import { FORMATS } from "open-sse/translator/formats.js";
import { initState, translateResponse } from "open-sse/translator/index.js";
import { translateNonStreamingResponse } from "open-sse/handlers/chatCore/nonStreamingHandler.js";

const { CHAT, MESSAGES, RESPONSES } = BUDGET_ENDPOINT;
const formats = { [CHAT]: FORMATS.OPENAI, [MESSAGES]: FORMATS.CLAUDE, [RESPONSES]: FORMATS.OPENAI_RESPONSES };
const fields = {
  [CHAT]: ["messages", "max_tokens", "stream_options"],
  [MESSAGES]: ["messages", "max_tokens", "system"],
  [RESPONSES]: ["input", "max_output_tokens", "instructions"],
};
const only = (obj, keys) => obj && typeof obj === "object" && !Array.isArray(obj) && Object.keys(obj).every(k => keys.includes(k));

function textContent(content, types) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content) || !content.length || !content.every(part =>
    only(part, ["type", "text"]) && types.includes(part.type) && typeof part.text === "string")) return null;
  return content.map(part => part.text).join("");
}

// Build the entire single-generation provider payload from approved fields.
export function budgetRequest(endpoint, body) {
  const responses = endpoint === RESPONSES;
  const maxTokens = responses ? body?.max_output_tokens : body?.max_tokens;
  if (!only(body, ["model", "stream", "temperature", "top_p", ...fields[endpoint]]) ||
      typeof body.model !== "string" || !body.model ||
      !Number.isSafeInteger(maxTokens) || maxTokens < 1 || maxTokens > 1e8 ||
      (body.stream !== undefined && typeof body.stream !== "boolean")) return null;
  const messages = [];
  const system = responses ? body.instructions : body.system;
  if (system !== undefined) {
    const text = textContent(system, responses ? [] : ["text"]);
    if (text === null) return null;
    messages.push({ role: "system", content: text });
  }
  const input = responses ? (typeof body.input === "string" ? [{ role: "user", content: body.input }] : body.input) : body.messages;
  const roles = endpoint === MESSAGES ? ["user", "assistant"] : ["user", "assistant", "system", ...(responses ? ["developer"] : [])];
  if (!Array.isArray(input) || !input.length) return null;
  for (const msg of input) {
    if (!only(msg, responses ? ["role", "content", "type"] : ["role", "content"]) ||
        !roles.includes(msg.role) || (msg.type !== undefined && msg.type !== "message")) return null;
    const content = textContent(msg.content, responses ? ["input_text", "output_text"] : endpoint === MESSAGES ? ["text"] : []);
    if (content === null) return null;
    messages.push({ role: msg.role, content });
  }
  return { model: body.model, messages, max_tokens: maxTokens, stream: body.stream,
    temperature: body.temperature, top_p: body.top_p, ...(body.stream && { stream_options: { include_usage: true } }) };
}

export function budgetJson(endpoint, json) {
  return translateNonStreamingResponse(json, FORMATS.OPENAI, formats[endpoint]);
}

export function budgetStreamRenderer(endpoint) {
  if (endpoint === CHAT) return null; // Preserve the original bytes.
  const format = formats[endpoint], state = initState(format);
  let terminal;
  function render(chunk) {
    return translateResponse(FORMATS.OPENAI, format, chunk, state).map(event =>
      `event: ${event.event ?? event.type}\ndata: ${JSON.stringify(event.data ?? event)}\n\n`).join("");
  }
  return {
    chunk(event) {
      const choice = event.choices?.[0];
      if (!choice) return "";
      // A client may stop reading at its terminal event. Hold that event until
      // the provider usage trailer, [DONE] and clean EOF have been observed.
      if (choice.finish_reason) {
        terminal = { ...event, choices: [{ ...choice, delta: {} }] };
        return render({ ...event, choices: [{ ...choice, finish_reason: null }] });
      }
      return render(event);
    },
    end(usage) {
      return (terminal ? render({ ...terminal, usage }) : "") + render(null);
    },
  };
}
