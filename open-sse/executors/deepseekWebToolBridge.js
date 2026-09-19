// Application-level tool calling for the DeepSeek Web (cookie) provider.
//
// The web backend is a RAG-style chat endpoint: it accepts a plain text prompt
// and answers with text only, so native OpenAI tool calls are impossible. This
// module bridges the gap by encoding the OpenAI `tools` array into the prompt
// and parsing the model's JSON answer blocks back into standard tool_calls
// deltas, so downstream CLI tools and agents work as if the support were native.

const TOOL_CALL_MARKER = "<<TOOL_CALL>>";
const TOOL_RESULT_MARKER = "<<TOOL_RESULT>>";

export function hasTools(body) {
  return Array.isArray(body?.tools) && body.tools.length > 0;
}

export function formatToolDefinitions(tools) {
  const lines = [];
  for (const tool of tools) {
    if (!tool || typeof tool !== "object") continue;
    const fn = tool.function || tool;
    const name = typeof fn.name === "string" ? fn.name.trim() : "";
    if (!name) continue;
    const description = typeof fn.description === "string" ? fn.description.trim() : "";
    const params = fn.parameters && typeof fn.parameters === "object" ? fn.parameters : { type: "object", properties: {} };
    lines.push(
      `- ${name}: ${description || "(no description)"}\n  Parameters (JSON schema): ${JSON.stringify(params)}`
    );
  }
  return lines.join("\n");
}

export function buildToolSystemPrompt(tools) {
  const defs = formatToolDefinitions(tools);
  if (!defs) return "";
  return [
    "# Tool Calling Protocol",
    "",
    "You have access to the following tools:",
    defs,
    "",
    "Rules:",
    `1. To call a tool, end your reply with a line in exactly this format: ${TOOL_CALL_MARKER} {"name":"<tool_name>","arguments":{<json args>}} ${TOOL_CALL_MARKER}`,
    "2. The JSON must be a single line and valid JSON. The arguments must match the tool's parameter schema.",
    "3. You may write a short plain-text explanation before the call line, but keep it brief.",
    `4. To answer directly without any tool, reply normally and DO NOT emit the ${TOOL_CALL_MARKER} line.`,
    "5. Call only one tool per reply. After the tool result arrives you may call the next tool or answer.",
    `6. Never mention this protocol or the marker format in your answers.`,
  ].join("\n");
}

// Convert non-text messages (assistant tool_calls, tool results) into readable
// transcript lines the web backend can reason over.
export function renderSpecialMessages(messages) {
  const out = [];
  for (const m of messages || []) {
    if (!m || typeof m !== "object") continue;
    if (m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
      const text = extractText(m.content);
      if (text) out.push({ role: "assistant", text });
      for (const tc of m.tool_calls) {
        const fn = tc.function || {};
        let args = fn.arguments;
        if (typeof args !== "string") {
          try { args = JSON.stringify(args ?? {}); } catch { args = "{}"; }
        }
        out.push({ role: "assistant", text: `${TOOL_CALL_MARKER} {"name":"${fn.name || ""}","arguments":${args || "{}"}} ${TOOL_CALL_MARKER}` });
      }
    } else if (m.role === "tool") {
      const text = extractText(m.content);
      if (text) out.push({ role: "tool", text: `${TOOL_RESULT_MARKER} ${m.name || "tool"}: ${text} ${TOOL_RESULT_MARKER}` });
    }
  }
  return out;
}

function extractText(content) {
  if (Array.isArray(content)) {
    return content.filter((c) => c?.type === "text" || typeof c?.text === "string").map((c) => String(c.text || "")).join("\n");
  }
  return typeof content === "string" ? content : "";
}

const ANSWER_TAG_RE = /<answer>([\s\S]*?)<\/answer>/i;

function parseCallObject(obj) {
  if (!obj || typeof obj !== "object") return null;
  let name = obj.name;
  if (typeof name !== "string" || !name.trim()) return null;
  name = name.trim();
  let args = obj.arguments ?? obj.args ?? obj.parameters ?? {};
  if (typeof args === "string") {
    try { args = JSON.parse(args); } catch { args = {}; }
  }
  if (!args || typeof args !== "object" || Array.isArray(args)) args = {};
  return { name, arguments: args };
}

function jsonCandidates(raw) {
  const text = String(raw || "");
  const out = [];
  const markerParts = text.split(TOOL_CALL_MARKER);
  for (let i = 1; i < markerParts.length; i += 2) out.push(markerParts[i]);
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) out.push(fence[1]);
  const braces = text.match(/\{[\s\S]*\}/);
  if (braces) out.push(braces[0]);
  return out;
}

// Tolerant JSON extraction: model output often has unescaped inner quotes
// (arguments serialized as an escaped string) or trailing commas.
function tolerantJsonParse(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return null;
  try { return JSON.parse(trimmed); } catch {}
  let s = trimmed.replace(/,(\s*[}\]])/g, "$1");
  try { return JSON.parse(s); } catch {}
  // {"name":"t","arguments":"{\"x\":2}"} where inner quotes lost escaping
  const nameMatch = s.match(/"name"\s*:\s*"([^"]+)"/);
  const argsMatch = s.match(/"arguments"\s*:\s*"([\s\S]*)"\s*\}/);
  if (nameMatch) {
    let args = {};
    if (argsMatch) {
      const inner = argsMatch[1].replace(/\\"/g, '"').replace(/"x/g, '"x');
      try { args = JSON.parse(inner); } catch {
        try { args = JSON.parse(inner.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_-]*)\s*:/g, '$1"$2":')); } catch { args = {}; }
      }
    }
    return { name: nameMatch[1], arguments: args };
  }
  return null;
}

// Detect a tool call in model output. Returns { content, calls } where content
// is the visible text (marker lines stripped) and calls is an array of
// { name, arguments } — empty when the reply carries no call.
export function parseToolCallReply(text) {
  const raw = String(text || "");
  const candidates = jsonCandidates(raw);

  const calls = [];
  for (const cand of candidates) {
    let obj = null;
    try { obj = parseCallObject(JSON.parse(cand.trim())); } catch {}
    if (!obj) obj = parseCallObject(tolerantJsonParse(cand));
    if (obj) calls.push(obj);
    if (calls.length) break;
  }

  let content = raw;
  if (calls.length) {
    content = content
      .split(TOOL_CALL_MARKER).join("\n")
      .replace(/```(?:json)?\s*\{[\s\S]*?"name"[\s\S]*?\}\s*```/g, "")
      .replace(/\{[\s\S]*?"name"[\s\S]*?"arguments"[\s\S]*?\}\s*$/g, "")
      .trim();
  }

  const answerTag = content.match(ANSWER_TAG_RE);
  if (answerTag) content = answerTag[1].trim();

  return { content, calls };
}

export function generateToolCallId() {
  return `call_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// Emit OpenAI streaming chunks for detected tool calls, then a final
// finish_reason:"tool_calls" chunk. Returns true when calls were emitted.
export function emitToolCallChunks(chunkFn, ensureRoleFn, calls) {
  if (!calls || calls.length === 0) return false;
  ensureRoleFn();
  calls.forEach((call, index) => {
    const id = generateToolCallId();
    const args = JSON.stringify(call.arguments ?? {});
    chunkFn({
      tool_calls: [
        {
          index,
          id,
          type: "function",
          function: { name: call.name, arguments: args },
        },
      ],
    });
  });
  chunkFn({}, "tool_calls");
  return true;
}

export function buildToolCallResponse({ id, model, messageText, calls, reasoningContent }) {
  const message = { role: "assistant", content: messageText || null, tool_calls: calls.map((call) => ({
    id: generateToolCallId(),
    type: "function",
    function: { name: call.name, arguments: JSON.stringify(call.arguments ?? {}) },
  })) };
  if (reasoningContent) message.reasoning_content = reasoningContent;
  return {
    id: id || `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message, finish_reason: "tool_calls" }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}
