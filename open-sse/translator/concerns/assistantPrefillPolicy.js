import { CLAUDE_BLOCK, ROLE } from "../schema/index.js";

const ASSISTANT_CONTINUATION_PROMPT = "Continue from the assistant response above without repeating it.";
const INCOMPLETE_TOOL_RESULT = "Tool execution was not completed before this request continued.";
const PRESERVE_HEADER = "x-9router-assistant-prefill";

function getHeader(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === "function") return headers.get(name);

  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name);
  const value = entry?.[1];
  return Array.isArray(value) ? value[0] : value;
}

function hasText(content) {
  if (typeof content === "string") return !!content.trim();
  return Array.isArray(content) && content.some(block =>
    block?.type === CLAUDE_BLOCK.TEXT && block.text?.trim()
  );
}

export function applyAssistantPrefillPolicy(body, rawHeaders = null) {
  if (!Array.isArray(body?.messages)) return body;
  if (String(getHeader(rawHeaders, PRESERVE_HEADER) || "").toLowerCase() === "preserve") return body;

  const trailingAssistant = body.messages.at(-1);
  if (trailingAssistant?.role !== ROLE.ASSISTANT) return body;

  const toolUses = Array.isArray(trailingAssistant.content)
    ? trailingAssistant.content.filter(block => block?.type === CLAUDE_BLOCK.TOOL_USE && block.id)
    : [];
  if (toolUses.length > 0) {
    body.messages.push({
      role: ROLE.USER,
      content: toolUses.map(toolUse => ({
        type: CLAUDE_BLOCK.TOOL_RESULT,
        tool_use_id: toolUse.id,
        is_error: true,
        content: INCOMPLETE_TOOL_RESULT,
      })),
    });
    return body;
  }

  if (!hasText(trailingAssistant.content)) {
    body.messages.pop();
    return body;
  }

  body.messages.push({
    role: ROLE.USER,
    content: [{ type: CLAUDE_BLOCK.TEXT, text: ASSISTANT_CONTINUATION_PROMPT }],
  });
  return body;
}
