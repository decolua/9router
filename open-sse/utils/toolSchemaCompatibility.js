const providerFeatureRegistry = {
  openrouter: {
    supportsRegex: true,
    supportsComplexConstraints: false,
  },
  groq: {
    supportsRegex: true,
    supportsComplexConstraints: true,
  },
};

function stripPatterns(value, inProperties = false) {
  if (Array.isArray(value)) return value.map((item) => stripPatterns(item, inProperties));
  if (!value || typeof value !== "object") return value;

  const cleaned = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "pattern" && !inProperties && typeof child === "string") {
      try {
        new RegExp(child);
      } catch {
        continue;
      }
    }
    cleaned[key] = stripPatterns(child, key === "properties");
  }
  return cleaned;
}

function normalizeSchemaForProvider(provider, schema) {
  const features = providerFeatureRegistry[provider] || {};
  if (!features.supportsRegex) {
    return stripPatterns(schema);
  }
  return schema;
}

export function normalizeToolSchemasForProvider(provider, tools) {
  if (!Array.isArray(tools)) return tools;

  return tools.map((tool) => ({
    ...tool,
    function: tool.function ? {
      ...tool.function,
      parameters: normalizeSchemaForProvider(provider, tool.function.parameters),
    } : tool.function,
  }));
}