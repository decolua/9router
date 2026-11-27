function displayText(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  // Signatures are replay metadata, not readable response content. The raw
  // provider response remains available in its existing collapsed section.
  return JSON.stringify(value, (key, item) => key === "signature" ? "[Hidden]" : item, 2);
}

export function formatRequestDetailResponse(response) {
  const content = [];
  const thinking = [];
  const blocks = Array.isArray(response?.content) ? response.content : [response?.content];

  for (const block of blocks) {
    if (block?.type === "thinking") {
      thinking.push(displayText(block.thinking) || "[Thinking content unavailable]");
    } else if (block?.type === "redacted_thinking") {
      thinking.push("[Redacted thinking]");
    } else {
      const text = displayText(block?.type === "text" ? block.text : block);
      if (text) content.push(text);
    }
  }

  return {
    content: content.join("\n") || "[No content]",
    // Normalized records may already carry the same thinking at top level.
    thinking: displayText(response?.thinking) || thinking.join("\n"),
  };
}
