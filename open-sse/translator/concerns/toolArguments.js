function schemaTypeMatches(value, type) {
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (type === "integer") return Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  return typeof value === type;
}

function fingerprint(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function summarizeToolArgumentFragment(value) {
  const text = String(value || "");
  const shape = text
    .replace(/"(?:\\.|[^"\\])*"/g, '"[redacted]"')
    .replace(/[A-Za-z0-9_./\\:-]+/g, "*")
    .slice(0, 96);
  return { length: text.length, fingerprint: fingerprint(text), shape };
}

function validateSchema(value, schema, path = "$") {
  if (!schema || typeof schema !== "object") return null;

  if (Array.isArray(schema.enum) && !schema.enum.some((item) => Object.is(item, value))) {
    return `${path} is not an allowed value`;
  }
  if (Object.prototype.hasOwnProperty.call(schema, "const") && !Object.is(schema.const, value)) {
    return `${path} does not match const`;
  }

  if (Array.isArray(schema.allOf)) {
    for (const candidate of schema.allOf) {
      const error = validateSchema(value, candidate, path);
      if (error) return error;
    }
  }

  if (Array.isArray(schema.anyOf)) {
    if (!schema.anyOf.some((candidate) => validateSchema(value, candidate, path) === null)) {
      return `${path} does not match any allowed schema`;
    }
  }

  if (Array.isArray(schema.oneOf)) {
    const matches = schema.oneOf.filter((candidate) => validateSchema(value, candidate, path) === null);
    if (matches.length !== 1) return `${path} must match exactly one schema`;
  }

  const allowedTypes = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (allowedTypes.length && !allowedTypes.some((type) => schemaTypeMatches(value, type))) {
    return `${path} must be ${allowedTypes.join(" or ")}`;
  }

  if (typeof value === "string") {
    if (Number.isInteger(schema.minLength) && value.length < schema.minLength) {
      return `${path} is shorter than minLength`;
    }
    if (Number.isInteger(schema.maxLength) && value.length > schema.maxLength) {
      return `${path} is longer than maxLength`;
    }
    if (schema.pattern) {
      try {
        if (!new RegExp(schema.pattern).test(value)) return `${path} does not match pattern`;
      } catch {
        return `${path} has an invalid schema pattern`;
      }
    }
  }

  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      return `${path} is below minimum`;
    }
    if (typeof schema.maximum === "number" && value > schema.maximum) {
      return `${path} is above maximum`;
    }
  }

  if (Array.isArray(value)) {
    if (Number.isInteger(schema.minItems) && value.length < schema.minItems) {
      return `${path} has fewer than minItems`;
    }
    if (Number.isInteger(schema.maxItems) && value.length > schema.maxItems) {
      return `${path} has more than maxItems`;
    }
    if (schema.items) {
      for (let index = 0; index < value.length; index++) {
        const error = validateSchema(value[index], schema.items, `${path}[${index}]`);
        if (error) return error;
      }
    }
  }

  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const properties = schema.properties && typeof schema.properties === "object"
      ? schema.properties
      : {};
    for (const required of Array.isArray(schema.required) ? schema.required : []) {
      if (!(required in value)) return `${path}.${required} is required`;
    }
    for (const [key, item] of Object.entries(value)) {
      if (properties[key]) {
        const error = validateSchema(item, properties[key], `${path}.${key}`);
        if (error) return error;
      } else if (schema.additionalProperties === false) {
        return `${path}.${key} is not allowed`;
      } else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
        const error = validateSchema(item, schema.additionalProperties, `${path}.${key}`);
        if (error) return error;
      }
    }
  }

  return null;
}

export function collectToolSchemas(tools = []) {
  const result = new Map();
  for (const tool of Array.isArray(tools) ? tools : []) {
    const name = tool?.function?.name || tool?.name;
    const schema = tool?.function?.parameters || tool?.input_schema || tool?.parameters;
    if (name && schema && typeof schema === "object") result.set(name, schema);
  }
  return result;
}

export function validateToolArguments(toolName, args, schemas) {
  const schema = schemas?.get?.(toolName);
  if (!schema) return { valid: true, error: null };
  const error = validateSchema(args, schema);
  return { valid: error === null, error };
}
