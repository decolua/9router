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

export function normalizeToolSchemasForProvider(provider, tools) {
  if (provider !== "openrouter" || !Array.isArray(tools)) return tools;

  return tools.map((tool) => ({
    ...tool,
    function: tool.function ? {
      ...tool.function,
      parameters: stripPatterns(tool.function.parameters),
    } : tool.function,
  }));
}