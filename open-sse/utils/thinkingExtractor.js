export function extractThinking(value) {
  if (!value) return null;
  const out = [];
  collectThinking(value, out);
  return [...new Set(out.filter(Boolean))].join("\n") || null;
}

function collectThinking(obj, out) {
  if (!obj || typeof obj !== "object") return;

  if (Array.isArray(obj)) {
    for (const item of obj) collectThinking(item, out);
    return;
  }

  if (typeof obj.reasoning_content === "string") out.push(obj.reasoning_content);
  if (typeof obj.thinking === "string") out.push(obj.thinking);
  if (obj.thought === true && typeof obj.text === "string") out.push(obj.text);

  if (obj.type === "thinking" && typeof obj.thinking === "string") out.push(obj.thinking);
  if (obj.type === "reasoning") {
    if (typeof obj.text === "string") out.push(obj.text);
    if (typeof obj.content === "string") out.push(obj.content);
    if (typeof obj.summary === "string") out.push(obj.summary);
  }

  if (obj.response) collectThinking(obj.response, out);
  if (obj.choices) collectThinking(obj.choices, out);
  if (obj.message) collectThinking(obj.message, out);
  if (obj.delta) collectThinking(obj.delta, out);
  if (obj.output) collectThinking(obj.output, out);
  if (obj.content) collectThinking(obj.content, out);
  if (obj.candidates) collectThinking(obj.candidates, out);
  if (obj.parts) collectThinking(obj.parts, out);
}
