// Convert OpenAI-style message lists into a single prompt for the muse web chat.
//
// muse.ai's web UI is a single text box, so multi-turn context and system
// prompts are serialised into one message. Image parts are extracted separately
// so the executor can attach them as files.

const ROLE_LABELS = {
  system: "System",
  developer: "System",
  user: "User",
  assistant: "Assistant",
  tool: "Tool",
};

/**
 * Flatten message content to text; image parts (data URLs / http(s) URLs) are
 * collected into `images` in order.
 */
function contentToText(content, images) {
  if (content === null || content === undefined) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts = [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    if (part.type === "text" || part.type === "input_text" || part.type === "output_text") {
      if (part.text) parts.push(part.text);
    } else if (part.type === "image_url" || part.type === "input_image") {
      const ref = part.image_url && typeof part.image_url === "object" ? part.image_url.url : part.image_url;
      if (ref) images.push(ref);
    }
  }
  return parts.filter(Boolean).join("\n");
}

/** Role/text pairs, using the same text extraction as `flattenMessages`. */
export function messageTurns(messages) {
  const turns = [];
  for (const message of messages || []) {
    const text = contentToText(message?.content, []).trim();
    if (text) turns.push([message?.role || "user", text]);
  }
  return turns;
}

/**
 * Flatten the full history into the single prompt typed into the muse.ai box.
 *
 * A lone user turn is sent verbatim; anything richer gets role headers plus an
 * [Instruction] suffix telling the agent to answer as the Assistant.
 */
export function flattenMessages(messages) {
  const images = [];
  const turns = [];
  for (const message of messages || []) {
    const role = message?.role || "user";
    const text = contentToText(message?.content, images).trim();
    if (text) turns.push([role, text]);
  }

  if (turns.length === 0) return { text: "", images };

  if (turns.length === 1 && turns[0][0] === "user") {
    return { text: turns[0][1], images };
  }

  const blocks = turns.map(([role, text]) => `[${ROLE_LABELS[role] || role}]\n${text}`);
  blocks.push(
    "[Instruction]\nContinue the conversation above and reply as the Assistant to the last " +
      "User message. Output only the reply."
  );
  return { text: blocks.join("\n\n"), images };
}
