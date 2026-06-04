// Caveman injector: appends a caveman-style instruction into the system message
// of the final request body, just before it is dispatched to the provider executor.
// Dispatches by format so it works for both translated and native-passthrough flows.

import { FORMATS } from "../translator/formats.js";
import { CAVEMAN_PROMPTS } from "./cavemanPrompts.js";

const SEP = "\n\n";

export function injectCaveman(body, format, level) {
  const prompt = CAVEMAN_PROMPTS[level];
  if (!body || !prompt) return;

  switch (format) {
    case FORMATS.CLAUDE:
      injectClaudeSystem(body, prompt);
      return;
    case FORMATS.GEMINI:
    case FORMATS.GEMINI_CLI:
    case FORMATS.VERTEX:
    case FORMATS.ANTIGRAVITY:
      // Antigravity wraps Gemini shape in body.request → injectGeminiSystem handles it
      injectGeminiSystem(body, prompt);
      return;
    default:
      // OpenAI and OpenAI-shaped formats (responses/codex/cursor/kiro/ollama)
      injectMessagesSystem(body, prompt);
  }
}

// OpenAI-shaped: messages[] (chat) or input[] (responses) or instructions (responses string)
function injectMessagesSystem(body, prompt) {
  // OpenAI Responses API: top-level string field
  if (typeof body.instructions === "string") {
    body.instructions = body.instructions
      ? `${body.instructions}${SEP}${prompt}`
      : prompt;
    return;
  }

  const arr = Array.isArray(body.messages) ? body.messages
    : Array.isArray(body.input) ? body.input
    : null;
  if (!arr) return;

  const idx = arr.findIndex(m => m && (m.role === "system" || m.role === "developer"));
  if (idx >= 0) {
    appendToOpenAIMessage(arr[idx], prompt);
  } else {
    arr.unshift({ role: "system", content: prompt });
  }
}

function appendToOpenAIMessage(msg, prompt) {
  if (typeof msg.content === "string") {
    msg.content = `${msg.content}${SEP}${prompt}`;
  } else if (Array.isArray(msg.content)) {
    // Responses-style array of parts {type:"input_text"|"text", text}
    msg.content.push({ type: "input_text", text: prompt });
  } else {
    msg.content = prompt;
  }
}

// Claude shape: body.system as string | array of {type:"text", text}
// Insert before the last cache_control block to keep caveman inside the cached prefix.
function injectClaudeSystem(body, prompt) {
  if (typeof body.system === "string" && body.system.length > 0) {
    body.system = `${body.system}${SEP}${prompt}`;
    return;
  }
  if (Array.isArray(body.system)) {
    const block = { type: "text", text: prompt };
    let lastCacheIdx = -1;
    for (let i = body.system.length - 1; i >= 0; i--) {
      if (body.system[i]?.cache_control) { lastCacheIdx = i; break; }
    }
    if (lastCacheIdx >= 0) {
      body.system.splice(lastCacheIdx, 0, block);
    } else {
      body.system.push(block);
    }
    return;
  }
  body.system = prompt;
}

// Gemini shape: body.system_instruction | body.systemInstruction | body.request.systemInstruction
// Each shape: { parts: [{ text }] }
function injectGeminiSystem(body, prompt) {
  const target = body.request && typeof body.request === "object" ? body.request : body;
  const useSnake = Object.prototype.hasOwnProperty.call(target, "system_instruction");
  const key = useSnake ? "system_instruction" : "systemInstruction";
  const sys = target[key];
  if (sys && Array.isArray(sys.parts)) {
    sys.parts.push({ text: prompt });
    return;
  }
  target[key] = { parts: [{ text: prompt }] };
}
