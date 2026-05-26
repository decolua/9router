// For OpenAI-compatible providers that don't natively support json_schema structured output,
// we inject the schema into the system prompt and downgrade response_format to json_object.
// This mirrors the approach already used in openai-to-claude.js.

/**
 * Injects JSON schema as a system-prompt instruction for providers that don't
 * natively support structured output via response_format.
 * @param {object} body - The request body (mutated in-place for messages, returns modified body)
 * @returns {object} The modified body
 */
export function injectJsonSchemaFallback(body) {
  if (!body?.response_format) return body;
  if (body.response_format?.type !== "json_schema") return body;
  if (!body.response_format?.json_schema?.schema) return body;

  const schemaJson = JSON.stringify(body.response_format.json_schema.schema, null, 2);
  const instruction = `You must respond with valid JSON that strictly follows this JSON schema:
\`\`\`json
${schemaJson}
\`\`\`
Respond ONLY with the JSON object, no other text, no markdown, no code fences.`;

  // Downgrade to json_object so the provider doesn't reject the field
  body.response_format = { type: "json_object" };

  // Prepend to system message or inject a new system message
  const systemMsg = { role: "system", content: instruction };
  if (Array.isArray(body.messages)) {
    const systemIdx = body.messages.findIndex(m => m.role === "system");
    if (systemIdx >= 0) {
      const existing = body.messages[systemIdx];
      const existingContent = typeof existing.content === "string" ? existing.content : JSON.stringify(existing.content);
      body.messages[systemIdx] = { role: "system", content: `${instruction}\n\n${existingContent}` };
    } else {
      body.messages.unshift(systemMsg);
    }
  } else if (typeof body.messages === "undefined") {
    // No messages array yet — this shouldn't happen in normal chat completions
    // but handle gracefully
    body.messages = [systemMsg];
  }

  return body;
}

export default injectJsonSchemaFallback;