function isValidRegex(pattern) {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

// Recursively strips invalid `pattern` regex constraints from a JSON Schema
// node. `properties` is special-cased because its keys are arbitrary
// property *names* (which may themselves be "pattern" or "properties") and
// must never be mistaken for the schema keywords of the same name — every
// other key recurses generically as an ordinary schema node.
function stripPatterns(schema, stats) {
  if (Array.isArray(schema)) return schema.map((item) => stripPatterns(item, stats));
  if (!schema || typeof schema !== "object") return schema;

  const cleaned = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "pattern" && typeof value === "string") {
      if (isValidRegex(value)) cleaned[key] = value;
      else stats.removed++;
      continue;
    }
    if (key === "properties" && value && typeof value === "object" && !Array.isArray(value)) {
      const props = {};
      for (const [propName, propSchema] of Object.entries(value)) {
        props[propName] = stripPatterns(propSchema, stats);
      }
      cleaned[key] = props;
      continue;
    }
    cleaned[key] = stripPatterns(value, stats);
  }
  return cleaned;
}

export function normalizeToolSchemasForProvider(provider, tools, log) {
  if (provider !== "openrouter" || !Array.isArray(tools)) return tools;

  const stats = { removed: 0 };
  const normalized = tools.map((tool) => ({
    ...tool,
    function: tool.function ? {
      ...tool.function,
      parameters: stripPatterns(tool.function.parameters, stats),
    } : tool.function,
  }));

  // Redacted diagnostic: provider + rule + count only, never the schema/field content itself.
  if (stats.removed > 0) {
    log?.debug?.("TOOLSCHEMA", `${provider} | stripped ${stats.removed} invalid pattern constraint${stats.removed > 1 ? "s" : ""}`);
  }

  return normalized;
}