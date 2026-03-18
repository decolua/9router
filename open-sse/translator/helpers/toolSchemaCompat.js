function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function normalizeToolDescription(desc) {
  if (typeof desc === "string") return desc;
  if (desc === null || desc === undefined) return "";
  if (typeof desc === "object") {
    try {
      return JSON.stringify(desc);
    } catch {
      return String(desc);
    }
  }
  return String(desc);
}

export function sanitizeJsonSchemaForOpenAI(schema) {
  if (!isPlainObject(schema)) {
    return { type: "object", properties: {} };
  }

  const sanitized = { ...schema };

  if (sanitized.type === "object") {
    const rawProperties = sanitized.properties;
    const nextProperties = {};

    if (isPlainObject(rawProperties)) {
      for (const [key, value] of Object.entries(rawProperties)) {
        nextProperties[key] = sanitizeJsonSchemaForOpenAI(value);
      }
    }

    sanitized.properties = nextProperties;
  }

  if (sanitized.type === "array" && isPlainObject(sanitized.items)) {
    sanitized.items = sanitizeJsonSchemaForOpenAI(sanitized.items);
  }

  for (const combiner of ["oneOf", "anyOf", "allOf"]) {
    if (Array.isArray(sanitized[combiner])) {
      sanitized[combiner] = sanitized[combiner].map(item => sanitizeJsonSchemaForOpenAI(item));
    }
  }

  if (Object.prototype.hasOwnProperty.call(sanitized, "not")) {
    sanitized.not = sanitizeJsonSchemaForOpenAI(sanitized.not);
  }

  return sanitized;
}

export function sanitizeOpenAIChatTool(tool) {
  if (!isPlainObject(tool) || tool.type !== "function" || !isPlainObject(tool.function)) {
    return tool;
  }

  return {
    ...tool,
    function: {
      ...tool.function,
      description: normalizeToolDescription(tool.function.description),
      parameters: sanitizeJsonSchemaForOpenAI(tool.function.parameters)
    }
  };
}

export function sanitizeOpenAIResponsesTool(tool) {
  if (!isPlainObject(tool) || tool.type !== "function") {
    return tool;
  }

  return {
    ...tool,
    description: normalizeToolDescription(tool.description),
    parameters: sanitizeJsonSchemaForOpenAI(tool.parameters)
  };
}

export function sanitizeRequestTools(body) {
  if (!isPlainObject(body) || !Array.isArray(body.tools)) {
    return body;
  }

  return {
    ...body,
    tools: body.tools.map(tool => {
      if (!isPlainObject(tool) || tool.type !== "function") return tool;
      if (isPlainObject(tool.function)) return sanitizeOpenAIChatTool(tool);
      return sanitizeOpenAIResponsesTool(tool);
    })
  };
}
