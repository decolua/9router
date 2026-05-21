/**
 * jsonSchemaCompat - Downgrade json_schema response_format to json_object
 * with schema injection into system prompt.
 *
 * Many OpenAI-compatible providers (Ollama, local models, etc.) don't support
 * OpenAI's `json_schema` response_format type natively. When they receive it,
 * they return empty or malformed content.
 *
 * This utility detects `response_format.type === "json_schema"` and:
 * 1. Injects the JSON schema into the system prompt (so the model knows the expected shape)
 * 2. Replaces `response_format` with `{"type": "json_object"}` (universally supported)
 *
 * This mirrors the approach already used in openai-to-claude.js translator,
 * but applies it for OpenAI-compatible providers that don't natively handle json_schema.
 *
 * Related issue: https://github.com/decolua/9router/issues/1343
 */

/**
 * Check if the provider supports json_schema response_format natively.
 * Providers known to support it: openai, azure.
 * All others get the fallback treatment.
 */
const JSON_SCHEMA_NATIVE_PROVIDERS = new Set([
  "openai",
  "azure",
]);

/**
 * Downgrade json_schema response_format to json_object + schema in system prompt.
 *
 * @param {object} params
 * @param {string} params.provider - Provider identifier (e.g. "ollama", "deepseek", "glm")
 * @param {object} params.body - Request body to transform
 * @returns {object} Transformed body (or original if no change needed)
 */
export function downgradeJsonSchema({ provider, body }) {
  if (!body?.response_format || body.response_format.type !== "json_schema") {
    return body;
  }

  // Skip providers that natively support json_schema
  if (JSON_SCHEMA_NATIVE_PROVIDERS.has(provider)) {
    return body;
  }

  const schema = body.response_format.json_schema?.schema;
  const schemaName = body.response_format.json_schema?.name || "response";

  if (!schema) {
    // No schema to inject, just downgrade to json_object
    return { ...body, response_format: { type: "json_object" } };
  }

  const schemaJson = JSON.stringify(schema, null, 2);
  const schemaInstruction =
    `You must respond with valid JSON that strictly follows this JSON schema:\n` +
    `Schema name: ${schemaName}\n` +
    `\`\`\`json\n${schemaJson}\n\`\`\`\n` +
    `Respond ONLY with the JSON object matching this schema, no other text.`;

  // Inject schema into system message
  const messages = Array.isArray(body.messages) ? [...body.messages] : [];

  const systemIdx = messages.findIndex(m => m.role === "system");

  if (systemIdx >= 0) {
    const sys = messages[systemIdx];
    const existingContent = typeof sys.content === "string"
      ? sys.content
      : extractTextFromContent(sys.content);
    messages[systemIdx] = { ...sys, content: existingContent + "\n\n" + schemaInstruction };
  } else {
    messages.unshift({ role: "system", content: schemaInstruction });
  }

  return {
    ...body,
    messages,
    response_format: { type: "json_object" },
  };
}

/**
 * Extract text from OpenAI-style content array.
 */
function extractTextFromContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter(c => c && c.type === "text" && c.text)
      .map(c => c.text)
      .join("\n");
  }
  return "";
}
