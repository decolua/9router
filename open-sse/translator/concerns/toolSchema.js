const ROOT_COMBINATORS = ["allOf", "oneOf", "anyOf"];

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function resolveLocalRef(schema, root, seen = new Set()) {
  if (!isRecord(schema) || typeof schema.$ref !== "string" || !schema.$ref.startsWith("#/")) return schema;
  if (seen.has(schema.$ref)) return schema;

  const path = schema.$ref.slice(2).split("/").map((part) =>
    part.replace(/~1/g, "/").replace(/~0/g, "~"));
  const target = path.reduce((value, part) =>
    isRecord(value) && Object.hasOwn(value, part) ? value[part] : undefined, root);
  if (!isRecord(target)) return schema;

  const nextSeen = new Set(seen).add(schema.$ref);
  const { $ref, ...overrides } = schema;
  return { ...resolveLocalRef(target, root, nextSeen), ...overrides };
}

function combineProperty(first, second, keyword) {
  if (first === undefined) return second;
  if (first === second || JSON.stringify(first) === JSON.stringify(second)) return first;
  return { [keyword]: [first, second] };
}

function flattenObjectSchema(schema, root, seenRefs = new Set()) {
  if (isRecord(schema) && typeof schema.$ref === "string") {
    if (seenRefs.has(schema.$ref)) return { type: "object", properties: {} };
    seenRefs = new Set(seenRefs).add(schema.$ref);
  }
  const resolved = resolveLocalRef(schema, root);
  if (!isRecord(resolved)) return { type: "object", properties: {} };

  const { allOf, oneOf, anyOf, ...base } = resolved;
  const properties = Object.assign(Object.create(null), isRecord(base.properties) ? base.properties : {});
  const required = new Set(Array.isArray(base.required) ? base.required : []);
  let disallowExtras = base.additionalProperties === false;

  for (const keyword of ROOT_COMBINATORS) {
    const variants = { allOf, oneOf, anyOf }[keyword];
    if (!Array.isArray(variants) || variants.length === 0) continue;

    const normalized = variants.map((variant) => flattenObjectSchema(variant, root, seenRefs));
    const combinedProperties = Object.create(null);
    for (const variant of normalized) {
      for (const [name, property] of Object.entries(variant.properties || {})) {
        combinedProperties[name] = combineProperty(
          combinedProperties[name], property, keyword === "allOf" ? "allOf" : "anyOf");
      }
    }
    for (const [name, property] of Object.entries(combinedProperties)) {
      properties[name] = combineProperty(properties[name], property, "allOf");
    }

    if (keyword === "allOf") {
      for (const variant of normalized) {
        for (const name of variant.required || []) required.add(name);
      }
    } else {
      const common = new Set(normalized[0].required || []);
      for (const variant of normalized.slice(1)) {
        for (const name of common) {
          if (!variant.required?.includes(name)) common.delete(name);
        }
      }
      for (const name of common) required.add(name);
    }

    const restrictsExtras = keyword === "allOf"
      ? normalized.some((variant) => variant.additionalProperties === false)
      : normalized.every((variant) => variant.additionalProperties === false);
    if (restrictsExtras) {
      disallowExtras = true;
    }
  }

  return {
    ...base,
    type: "object",
    properties,
    ...(required.size ? { required: [...required] } : {}),
    ...(disallowExtras ? { additionalProperties: false } : {}),
  };
}

/**
 * Claude requires an object-root tool schema without oneOf/allOf/anyOf at that
 * root. Merge object variants into a property superset so tool calls retain the
 * caller's argument shape; leave nested schemas and the source object untouched.
 */
export function normalizeClaudeToolInputSchema(schema) {
  if (!isRecord(schema)) return { type: "object", properties: {} };
  if (schema.type === "object" && !schema.$ref && !ROOT_COMBINATORS.some((key) => key in schema)) {
    return schema;
  }
  return flattenObjectSchema(schema, schema);
}
