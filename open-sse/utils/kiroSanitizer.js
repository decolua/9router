import { createHash } from "crypto";

const STRIP_KEYS = new Set([
  "additionalProperties",
  "anyOf", "oneOf", "allOf", "not",
  "$schema", "$id", "$ref", "$defs", "definitions",
  "if", "then", "else",
  "unevaluatedProperties", "unevaluatedItems",
  "contentEncoding", "contentMediaType"
]);

function stripKeys(obj) {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(stripKeys);

  const cleaned = {};
  for (const [key, value] of Object.entries(obj)) {
    if (STRIP_KEYS.has(key)) continue;
    if (key === "required" && Array.isArray(value) && value.length === 0) continue;
    cleaned[key] = stripKeys(value);
  }
  return cleaned;
}

export function sanitizeKiroTools(tools) {
  if (!tools || !Array.isArray(tools)) return { tools, nameMap: new Map() };

  const nameMap = new Map();

  const sanitized = tools.map(tool => {
    const spec = tool.toolSpecification;
    if (!spec) return tool;

    const originalName = spec.name;
    let name = originalName;
    if (name && name.length > 64) {
      const hash = createHash("sha256").update(name).digest("hex").slice(0, 7);
      name = name.slice(0, 56) + "_" + hash;
      nameMap.set(name, originalName);
    }

    const schema = spec.inputSchema?.json;
    if (schema && typeof schema === "object" && !Array.isArray(schema)) {
      const sanitized = stripKeys(schema);
      if (!sanitized.required) {
        sanitized.required = [];
      }

      return {
        ...tool,
        toolSpecification: {
          ...spec,
          name,
          inputSchema: { json: sanitized }
        }
      };
    }

    return {
      ...tool,
      toolSpecification: { ...spec, name }
    };
  });

  return { tools: sanitized, nameMap };
}
