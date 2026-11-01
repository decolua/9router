// Shared OpenAI-style tool calling for web-cookie providers.
//
// WHY THIS EXISTS
// A web-cookie provider is a RAG-style chat endpoint behind a browser session:
// it accepts a plain text prompt and answers with text only. It has no
// protocol-level function calling, so an agent that sends `tools` either gets a
// prose answer it cannot execute or a hard 400. This module bridges that gap
// at the application level: the OpenAI `tools` array is encoded into the prompt
// and the model's reply is parsed back into standard `tool_calls`, so the client
// sees ordinary OpenAI output and its own handlers run unchanged.
//
// The prompt shape follows zexadev/gemini-web2api-go (internal/app/messages.go):
//   1. a leading "[System instruction]: You have access to tools" block that
//      carries the schema and the tool_choice rule (none / auto / required /
//      a forced function name), then
//   2. the normal transcript, then
//   3. a trailing "highest priority" reminder that re-anchors the fence
//      format. Without the tail anchor a 40KB agent system prompt with its own
//      "emit function calls" wording drowns the leading rule and the model
//      answers "I have no tools" or writes a ```powershell block for the user.
//      The behavioural few-shot at the end is what makes the fence actually
//      come out (measured 3-4/4 with the example, 0/4 without).
//
// Two fence styles are supported because providers differ in what they obey:
//   - "marker" : <<TOOL_CALL>> {"name":"x","arguments":{...}} <<TOOL_CALL>>
//   - "fenced" : ```tool_call\n{"name":"x","arguments":{...}}\n```
// `pickFenceStyle` chooses per provider; parsers accept both either way so a
// model that mixes styles still gets its call recovered.

import { estimateInputTokens, estimateOutputTokens } from "../utils/usageTracking.js";

const MARKER = "<<TOOL_CALL>>";
const RESULT_MARKER = "<<TOOL_RESULT>>";
const FENCE_OPEN = "```tool_call";
const FENCE_CLOSE = "```";

// ---------------------------------------------------------------- tool schema

export function hasTools(body) {
  const tools = Array.isArray(body?.tools) ? body.tools : null;
  if (tools && tools.length > 0) return true;
  const fns = Array.isArray(body?.functions) ? body.functions : null;
  return Boolean(fns && fns.length > 0);
}

function fnOf(tool) {
  if (tool && typeof tool === "object" && tool.function && typeof tool.function === "object") {
    return tool.function;
  }
  return tool && typeof tool === "object" ? tool : {};
}

/** Tool definitions the model is allowed to name, honouring a forced function. */
export function selectableTools(body) {
  const raw = Array.isArray(body?.tools) && body.tools.length
    ? body.tools
    : (Array.isArray(body?.functions) && body.functions.length ? body.functions : []);
  const { mode, forced } = parseToolChoice(body?.tool_choice ?? body?.toolChoice);
  const out = [];
  for (const tool of raw) {
    const fn = fnOf(tool);
    const name = typeof fn.name === "string" ? fn.name.trim() : "";
    if (!name) continue;
    if (forced && name !== forced) continue;
    out.push({
      name,
      description: typeof fn.description === "string" ? fn.description : "",
      parameters:
        fn.parameters && typeof fn.parameters === "object"
          ? fn.parameters
          : { type: "object", properties: {} },
    });
  }
  return { defs: out, mode, forced };
}

/**
 * OpenAI tool_choice -> { mode, forced }.
 * mode is "none" | "auto" | "required"; forced is a function name or "".
 */
export function parseToolChoice(raw) {
  if (raw == null) return { mode: "auto", forced: "" };
  if (typeof raw === "string") {
    const v = raw.trim().toLowerCase();
    if (v === "none") return { mode: "none", forced: "" };
    if (v === "required" || v === "any") return { mode: "required", forced: "" };
    return { mode: "auto", forced: "" };
  }
  if (typeof raw === "object") {
    const name = raw?.function?.name ?? raw?.name;
    if (typeof name === "string" && name.trim()) {
      return { mode: "required", forced: name.trim() };
    }
  }
  return { mode: "auto", forced: "" };
}

export function pickFenceStyle(explicit) {
  if (explicit === "marker" || explicit === "fenced") return explicit;
  return "marker";
}

// ------------------------------------------------------------------- prompting

function instructionLine(mode, forced) {
  if (forced) {
    return `You MUST call the tool "${forced}". Reply with the tool_call block and nothing else - do not answer the question yourself, even if you know the answer.`;
  }
  if (mode === "required") {
    return "You MUST call one of the tools above. Reply with the tool_call block and nothing else - do not answer the question yourself, even if you know the answer.";
  }
  return "Only use tool_call blocks when needed.";
}

function exampleBlock(style) {
  const json = '{\n  "name": "run_command",\n  "arguments": {\n    "command": "ls -la"\n  }\n}';
  if (style === "fenced") return `${FENCE_OPEN}\n${json}\n${FENCE_CLOSE}`;
  return `${MARKER} ${json} ${MARKER}`;
}

/**
 * The leading system instruction carrying the schema and the choice rule.
 * Returns "" when the request asks for no tools at all.
 */
export function buildToolInstructions(body, style = "marker") {
  const { defs, mode, forced } = selectableTools(body);
  if (!defs.length) return "";
  const rule = instructionLine(mode, forced);
  const defsJson = JSON.stringify(defs, null, 2);
  if (style === "fenced") {
    return [
      "[System instruction]: You have access to tools. To call a tool, respond with:",
      FENCE_OPEN,
      '{"name": "func_name", "arguments": {...}}',
      FENCE_CLOSE,
      rule,
      "",
      "Available tools:",
      defsJson,
    ].join("\n");
  }
  return [
    "[System instruction]: You have access to tools. To call a tool, respond with:",
    `${MARKER} {"name": "func_name", "arguments": {...}} ${MARKER}`,
    rule,
    "",
    "Available tools:",
    defsJson,
  ].join("\n");
}

/**
 * The trailing highest-priority reminder. Re-anchors the fence format after a
 * long agent system prompt, and states plainly that a shell code block is not
 * an execution channel.
 */
export function buildToolReminder(style = "marker", options = {}) {
  const { forced = "", mode = "auto" } = options || {};
  const forcedLine = forced
    ? `This turn is FORCED: the client set tool_choice to the tool "${forced}". Emit exactly one tool_call block calling "${forced}" with valid arguments and nothing else - answering in prose is a protocol violation, even if you already know the answer.`
    : mode === "required"
      ? "This turn is FORCED: the client set tool_choice to require a tool. Emit one tool_call block and nothing else - answering in prose is a protocol violation."
      : "";
  const lines = [
    "[System instruction - highest priority]: To run a command or read a file you MUST output a tool_call block - this is the ONLY execution channel. A code block is NOT executed, it is only shown to the user; never use one to run anything, and never claim you lack tools.",
    "Act, do not explain: when the request needs a tool, your reply is ONE tool_call block and nothing else - do not list the commands you 'would' run, do not add prose. Emit several blocks only when the user asks for several independent things at once (one block per call, nothing else); when the steps depend on each other, do the FIRST one now and you will be called again with its result.",
    "Know when to STOP: once a tool result shows a step succeeded (for example it exited with code 0, even with no printed output), that step is DONE - do not run it again and do not retry the same thing a different way. When the whole request is accomplished, stop calling tools and reply with a short final answer instead of another tool_call.",
    "Example of a correct turn - user asks \"list the files here and tell me the size of README.md\", you reply with exactly one block and nothing else:",
    exampleBlock(style),
    "(In your block use one of the real tool names listed above with its own arguments.) When the request needs a tool, emit the tool_call block now.",
  ];
  if (forcedLine) lines.push(forcedLine);
  return lines.join("\n");
}

// ------------------------------------------------------------------ transcript

function textOf(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((c) => c && (c.type === "text" || typeof c.text === "string"))
      .map((c) => String(c.text ?? ""))
      .join("\n");
  }
  if (content && typeof content === "object" && typeof content.text === "string") return content.text;
  return "";
}

export { textOf as extractText };

function callLine(name, argsJson, style) {
  const payload = `{"name": ${JSON.stringify(name)}, "arguments": ${argsJson}}`;
  if (style === "fenced") return `${FENCE_OPEN}\n${payload}\n${FENCE_CLOSE}`;
  return `${MARKER} ${payload} ${MARKER}`;
}

/**
 * Flatten assistant tool_calls and tool results into transcript lines the web
 * backend can read. Returns only the messages that carry non-text content.
 */
export function renderToolTranscript(messages, style = "marker") {
  const out = [];
  for (const m of Array.isArray(messages) ? messages : []) {
    if (!m || typeof m !== "object") continue;
    if (m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length) {
      const text = textOf(m.content);
      const calls = [];
      for (const tc of m.tool_calls) {
        const fn = tc?.function || {};
        let args = fn.arguments;
        if (args && typeof args === "object") args = JSON.stringify(args);
        if (typeof args !== "string" || !args.trim()) args = "{}";
        calls.push(callLine(String(fn.name || ""), args, style));
      }
      const line = text ? `[Assistant]: ${text}\n${calls.join("\n")}` : `[Assistant]: ${calls.join("\n")}`;
      out.push({ role: "assistant", text: line });
    } else if (m.role === "tool") {
      const text = textOf(m.content);
      if (text) out.push({ role: "tool", text: `${RESULT_MARKER} ${m.name || "tool"}: ${text} ${RESULT_MARKER}` });
    }
  }
  return out;
}

// --------------------------------------------------------------------- parsing

function parseCallObject(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const name = typeof obj.name === "string" ? obj.name.trim() : "";
  if (!name) return null;
  let args = obj.arguments ?? obj.args ?? obj.parameters ?? obj.input ?? {};
  if (typeof args === "string") {
    try { args = JSON.parse(args); } catch { args = {}; }
  }
  if (!args || typeof args !== "object" || Array.isArray(args)) args = {};
  return { name, arguments: args };
}

/** Lenient parse: unescaped inner quotes and trailing commas are common. */
function tolerantJsonParse(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return null;
  try { return JSON.parse(trimmed); } catch {}
  const noTrailing = trimmed.replace(/,(\s*[}\]])/g, "$1");
  try { return JSON.parse(noTrailing); } catch {}
  const nameMatch = noTrailing.match(/"name"\s*:\s*"([^"]+)"/);
  if (!nameMatch) return null;
  const argsMatch = noTrailing.match(/"arguments"\s*:\s*([\s\S]*?)\s*\}\s*$/);
  let args = {};
  if (argsMatch) {
    const inner = argsMatch[1].replace(/,\s*$/, "").replace(/^"/, "").replace(/"$/, "").replace(/\\"/g, '"');
    try { args = JSON.parse(inner); } catch {
      try {
        args = JSON.parse(inner.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_-]*)\s*:/g, '$1"$2":'));
      } catch { args = {}; }
    }
  }
  return { name: nameMatch[1], arguments: args };
}

function markerCandidates(text) {
  const out = [];
  const parts = text.split(MARKER);
  for (let i = 1; i < parts.length; i += 2) out.push(parts[i]);
  return out;
}

function fenceCandidates(text) {
  const out = [];
  const re = new RegExp(`${FENCE_OPEN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*([\\s\\S]*?)${FENCE_CLOSE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "g");
  for (const m of text.matchAll(re)) out.push(m[1]);
  const loose = text.match(/```(?:json)?\s*([\s\S]*?"name"[\s\S]*?)```/g) || [];
  for (const block of loose) {
    const inner = block.replace(/```(?:json|tool_call)?/g, "").replace(/```/g, "").trim();
    if (inner) out.push(inner);
  }
  return out;
}

/**
 * Recover tool calls from a model reply.
 * Returns { content, calls } where content is the visible text with the fence
 * lines removed, and calls is an array of { name, arguments }.
 */
export function parseToolCallReply(text) {
  const raw = String(text ?? "");
  const candidates = [...fenceCandidates(raw), ...markerCandidates(raw)];
  if (!candidates.length) {
    const brace = raw.match(/\{\s*"name"\s*:[\s\S]*\}/);
    if (brace) candidates.push(brace[0]);
  }

  const calls = [];
  for (const cand of candidates) {
    let obj = null;
    try { obj = parseCallObject(JSON.parse(cand.trim())); } catch {}
    if (!obj) obj = parseCallObject(tolerantJsonParse(cand));
    if (obj) {
      calls.push(obj);
      break;
    }
  }

  let content = raw;
  if (calls.length) {
    content = content
      .split(MARKER).join("\n")
      .replace(/```tool_call\s*[\s\S]*?```/g, "")
      .replace(/\{\s*"name"\s*:\s*"[^"]*"[\s\S]*?\}\s*$/g, "")
      .trim();
  }
  const answer = content.match(/<answer>([\s\S]*?)<\/answer>/i);
  if (answer) content = answer[1].trim();
  return { content, calls };
}

// ------------------------------------------------------------------- emission

let idSeq = 0;
export function generateToolCallId() {
  idSeq += 1;
  return `call_${Date.now().toString(36)}${idSeq.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Strip fences and emit OpenAI streaming chunks, then finish_reason. */
export function emitToolCallChunks(chunkFn, ensureRoleFn, calls) {
  if (!calls || !calls.length) return false;
  ensureRoleFn?.();
  calls.forEach((call, index) => {
    chunkFn({
      tool_calls: [
        {
          index,
          id: generateToolCallId(),
          type: "function",
          function: { name: call.name, arguments: JSON.stringify(call.arguments ?? {}) },
        },
      ],
    });
  });
  chunkFn({}, "tool_calls");
  return true;
}

export function buildToolCallResponse({ id, model, messageText, calls, reasoningContent, body }) {
  const message = {
    role: "assistant",
    content: messageText || null,
    tool_calls: calls.map((call) => ({
      id: generateToolCallId(),
      type: "function",
      function: { name: call.name, arguments: JSON.stringify(call.arguments ?? {}) },
    })),
  };
  if (reasoningContent) message.reasoning_content = reasoningContent;
  const outputLen = (messageText ? messageText.length : 0) +
    (reasoningContent ? reasoningContent.length : 0) +
    (calls?.length ? JSON.stringify(calls).length : 0);
  const promptTokens = body ? estimateInputTokens(body) : 0;
  const completionTokens = estimateOutputTokens(outputLen);
  return {
    id: id || `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message, finish_reason: "tool_calls" }],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
      estimated: true,
    },
  };
}

export const __selftest = {
  parseToolChoice,
  selectableTools,
  buildToolInstructions,
  buildToolReminder,
  parseToolCallReply,
  renderToolTranscript,
  hasTools,
};