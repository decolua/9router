/**
 * Cloud Code Assist (CCA) / Google Antigravity Tool Schema Normalizer
 * Sanitizes JSON Schemas from agent harnesses (Claude Code, Cursor, Cline)
 * to comply with Google Cloud Code Assist functionDeclarations OpenAPI 3.0 schema subset.
 */

// Fields explicitly rejected by Google Cloud Code Assist
export const CCA_REJECTED_FIELDS = new Set([
  "$comment",
  "$schema",
  "$id",
  "$ref",
  "$defs",
  "definitions",
  "readOnly",
  "writeOnly",
  "deprecated",
  "default",
  "examples",
  "title",
  // Unsupported object constraints
  "additionalProperties",
  "patternProperties",
  "propertyNames",
  "dependencies",
  "dependentRequired",
  "dependentSchemas",
  // Unsupported scalar constraints
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "pattern",
  "format",
  // Unsupported array constraints
  "minItems",
  "maxItems",
  "uniqueItems",
  "contains",
  "prefixItems",
  "additionalItems",
  // Unsupported Draft 2020-12
  "unevaluatedProperties",
  "unevaluatedItems",
  "contentSchema",
  "contentMediaType",
  "contentEncoding",
  // Conditionals and combiners
  "if",
  "then",
  "else",
  "not",
  // Cursor UI styling fields
  "cornerRadius",
  "fillColor",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "gap",
  "padding",
  "strokeColor",
  "strokeThickness",
  "textColor",
]);

/**
 * Coerce a boolean subschema to a valid object equivalent.
 * Draft 7 / 2020-12 allow true / false as boolean subschemas:
 * true -> {}
 * false -> { not: {} }
 */
export function coerceBooleanSubschema(schema) {
  if (typeof schema === "boolean") {
    return schema ? {} : { not: {} };
  }
  return schema;
}

/**
 * Select the best non-null schema from a list of union options (anyOf/oneOf).
 */
function selectBestUnionCandidate(candidates) {
  let best = null;
  let bestScore = -1;

  for (const c of candidates) {
    if (!c || typeof c !== "object") continue;
    let score = 0;
    const type = Array.isArray(c.type) ? c.type[0] : c.type;

    if (type === "object" || c.properties) {
      score = 4;
    } else if (type === "array" || c.items) {
      score = 3;
    } else if (type && type !== "null") {
      score = 2;
    } else if (c.description || c.enum) {
      score = 1;
    }

    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }

  return best;
}

/**
 * Collapse union types (anyOf, oneOf) and type arrays into a scalar type or best object/array.
 */
function collapseUnionsAndCombiners(schema) {
  if (!schema || typeof schema !== "object") return;

  // 1. Handle type as array: ["string", "null"] -> "string"
  if (Array.isArray(schema.type)) {
    const nonNullTypes = schema.type.filter(t => t !== "null");
    schema.type = nonNullTypes.length > 0 ? nonNullTypes[0] : "string";
  }

  // 2. Handle anyOf
  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
    const normalizedOptions = schema.anyOf.map(coerceBooleanSubschema).filter(s => s && s.type !== "null");
    if (normalizedOptions.length > 0) {
      const best = selectBestUnionCandidate(normalizedOptions);
      if (best) {
        delete schema.anyOf;
        const description = schema.description || best.description;
        Object.assign(schema, best);
        if (description) schema.description = description;
      } else {
        delete schema.anyOf;
        if (!schema.type) schema.type = "string";
      }
    } else {
      delete schema.anyOf;
      if (!schema.type) schema.type = "string";
    }
  }

  // 3. Handle oneOf
  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    const normalizedOptions = schema.oneOf.map(coerceBooleanSubschema).filter(s => s && s.type !== "null");
    if (normalizedOptions.length > 0) {
      const best = selectBestUnionCandidate(normalizedOptions);
      if (best) {
        delete schema.oneOf;
        const description = schema.description || best.description;
        Object.assign(schema, best);
        if (description) schema.description = description;
      } else {
        delete schema.oneOf;
        if (!schema.type) schema.type = "string";
      }
    } else {
      delete schema.oneOf;
      if (!schema.type) schema.type = "string";
    }
  }

  // 4. Handle allOf: merge properties and required
  if (Array.isArray(schema.allOf) && schema.allOf.length > 0) {
    const allOf = schema.allOf.map(coerceBooleanSubschema);
    delete schema.allOf;
    schema.properties = schema.properties || {};
    schema.required = schema.required || [];

    for (const sub of allOf) {
      if (!sub || typeof sub !== "object") continue;
      if (sub.properties && typeof sub.properties === "object") {
        Object.assign(schema.properties, sub.properties);
      }
      if (Array.isArray(sub.required)) {
        for (const req of sub.required) {
          if (!schema.required.includes(req)) {
            schema.required.push(req);
          }
        }
      }
      if (!schema.type && sub.type) {
        schema.type = sub.type;
      }
    }
  }
}

/**
 * Normalizes a JSON Schema to comply with Google Cloud Code Assist (CCA) requirements.
 *
 * @param {object|boolean} rawSchema - The input JSON schema from client/agent
 * @returns {object} The normalized schema safe for CCA
 */
export function normalizeSchemaForCCA(rawSchema) {
  if (rawSchema === null || rawSchema === undefined) {
    return { type: "object", properties: {} };
  }

  // Handle root boolean schema
  if (typeof rawSchema === "boolean") {
    return rawSchema ? { type: "object", properties: {} } : { type: "object", properties: {} };
  }

  // Deep clone to avoid mutating callers
  const schema = structuredClone(rawSchema);

  function walk(node) {
    if (!node || typeof node !== "object") return node;

    // 1. Collapse unions and combiners first
    collapseUnionsAndCombiners(node);

    // 2. Coerce const to enum
    if (node.const !== undefined && !node.enum) {
      node.enum = [node.const];
      delete node.const;
    }

    // 3. Stringify enum values & ensure type: "string"
    if (Array.isArray(node.enum)) {
      node.enum = node.enum.map(v => String(v));
      if (!node.type) node.type = "string";
    }

    // 4. Strip rejected fields
    for (const key of Object.keys(node)) {
      if (CCA_REJECTED_FIELDS.has(key) || key.startsWith("x-")) {
        delete node[key];
      }
    }

    // 5. Ensure object type and explicit properties: {}
    if (node.type === "object" || node.properties || (!node.type && !node.items && !node.enum)) {
      node.type = "object";
      if (!node.properties || typeof node.properties !== "object" || Array.isArray(node.properties)) {
        node.properties = {};
      }
    }

    // 6. Ensure array type and items
    if (node.type === "array") {
      if (!node.items) {
        node.items = { type: "string" };
      } else if (typeof node.items === "boolean") {
        node.items = coerceBooleanSubschema(node.items);
      }
    }

    // 7. Clean up required array
    if (node.required !== undefined) {
      if (Array.isArray(node.required) && node.properties) {
        node.required = node.required.filter(
          req => typeof req === "string" && Object.prototype.hasOwnProperty.call(node.properties, req)
        );
        if (node.required.length === 0) {
          delete node.required;
        }
      } else {
        delete node.required;
      }
    }

    // 8. Recurse into properties
    if (node.properties && typeof node.properties === "object") {
      for (const [propName, propVal] of Object.entries(node.properties)) {
        if (typeof propVal === "boolean") {
          node.properties[propName] = coerceBooleanSubschema(propVal);
        }
        walk(node.properties[propName]);
      }
    }

    // 9. Recurse into items
    if (node.items && typeof node.items === "object") {
      walk(node.items);
    }

    return node;
  }

  const result = walk(schema);

  // Guarantee root object format
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return { type: "object", properties: {} };
  }

  if (result.type !== "object") {
    result.type = "object";
  }

  if (!result.properties || typeof result.properties !== "object" || Array.isArray(result.properties)) {
    result.properties = {};
  }

  return result;
}

export default normalizeSchemaForCCA;
