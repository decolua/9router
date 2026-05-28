'use strict';

const crypto = require('crypto');

function formatOpenAIStreamToolCalls(calls, idStore, toolsRaw) {
  if (!Array.isArray(calls) || calls.length === 0) {
    return [];
  }
  const normalized = normalizeParsedToolCallsForSchemas(calls, toolsRaw);
  return normalized.map((c, idx) => ({
    index: idx,
    id: ensureStreamToolCallID(idStore, idx),
    type: 'function',
    function: {
      name: c.name,
      arguments: JSON.stringify(c.input || {}),
    },
  }));
}

function normalizeParsedToolCallsForSchemas(calls, toolsRaw) {
  if (!Array.isArray(calls) || calls.length === 0) {
    return calls;
  }
  const schemas = buildToolSchemaIndex(toolsRaw);
  if (!schemas) {
    return calls;
  }
  let changedAny = false;
  const out = calls.map((call) => {
    const name = String(call && call.name || '').trim().toLowerCase();
    const schema = schemas[name];
    if (!schema || !call || !call.input || typeof call.input !== 'object' || Array.isArray(call.input)) {
      return call;
    }
    const [normalized, changed] = normalizeToolValueWithSchema(call.input, schema);
    if (!changed || !normalized || typeof normalized !== 'object' || Array.isArray(normalized)) {
      return call;
    }
    changedAny = true;
    return { ...call, input: normalized };
  });
  return changedAny ? out : calls;
}

function buildToolSchemaIndex(toolsRaw) {
  if (!Array.isArray(toolsRaw) || toolsRaw.length === 0) {
    return null;
  }
  const out = {};
  for (const item of toolsRaw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      continue;
    }
    const [name, schema] = extractToolNameAndSchema(item);
    if (!name || !schema || typeof schema !== 'object' || Array.isArray(schema)) {
      continue;
    }
    out[name.toLowerCase()] = schema;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function extractToolNameAndSchema(tool) {
  const fn = tool && typeof tool.function === 'object' && !Array.isArray(tool.function) ? tool.function : null;
  const name = firstNonEmptyString(tool.name, fn && fn.name);
  const schema = firstNonNil(
    tool.parameters,
    tool.input_schema,
    tool.inputSchema,
    tool.schema,
    fn && fn.parameters,
    fn && fn.input_schema,
    fn && fn.inputSchema,
    fn && fn.schema,
  );
  return [name, schema];
}

function normalizeToolValueWithSchema(value, schema) {
  if (value == null || !schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return [value, false];
  }
  if (shouldCoerceSchemaToString(schema)) {
    return stringifySchemaValue(value);
  }
  if (looksLikeObjectSchema(schema)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return [value, false];
    }
    const properties = schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties) ? schema.properties : null;
    const additional = schema.additionalProperties;
    let changed = false;
    const out = {};
    for (const [key, current] of Object.entries(value)) {
      let next = current;
      let fieldChanged = false;
      if (properties && Object.prototype.hasOwnProperty.call(properties, key)) {
        [next, fieldChanged] = normalizeToolValueWithSchema(current, properties[key]);
      } else if (additional != null) {
        [next, fieldChanged] = normalizeToolValueWithSchema(current, additional);
      }
      out[key] = next;
      changed = changed || fieldChanged;
    }
    return changed ? [out, true] : [value, false];
  }
  if (looksLikeArraySchema(schema)) {
    if (!Array.isArray(value) || value.length === 0 || schema.items == null) {
      return [value, false];
    }
    let changed = false;
    const out = value.map((item, idx) => {
      const itemSchema = Array.isArray(schema.items) ? schema.items[idx] : schema.items;
      if (itemSchema == null) {
        return item;
      }
      const [next, itemChanged] = normalizeToolValueWithSchema(item, itemSchema);
      changed = changed || itemChanged;
      return next;
    });
    return changed ? [out, true] : [value, false];
  }
  return [value, false];
}

function shouldCoerceSchemaToString(schema) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return false;
  }
  if (typeof schema.const === 'string') {
    return true;
  }
  if (Array.isArray(schema.enum) && schema.enum.length > 0 && schema.enum.every((item) => typeof item === 'string')) {
    return true;
  }
  if (typeof schema.type === 'string') {
    return schema.type.trim().toLowerCase() === 'string';
  }
  if (Array.isArray(schema.type) && schema.type.length > 0) {
    let hasString = false;
    for (const item of schema.type) {
      if (typeof item !== 'string') {
        return false;
      }
      const typ = item.trim().toLowerCase();
      if (typ === 'string') {
        hasString = true;
      } else if (typ !== 'null') {
        return false;
      }
    }
    return hasString;
  }
  return false;
}

function looksLikeObjectSchema(schema) {
  return !!schema && typeof schema === 'object' && !Array.isArray(schema) && (
    (typeof schema.type === 'string' && schema.type.trim().toLowerCase() === 'object') ||
    (schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties)) ||
    schema.additionalProperties != null
  );
}

function looksLikeArraySchema(schema) {
  return !!schema && typeof schema === 'object' && !Array.isArray(schema) && (
    (typeof schema.type === 'string' && schema.type.trim().toLowerCase() === 'array') ||
    schema.items != null
  );
}

function stringifySchemaValue(value) {
  if (value == null) {
    return [value, false];
  }
  if (typeof value === 'string') {
    return [value, false];
  }
  try {
    return [JSON.stringify(value), true];
  } catch {
    return [value, false];
  }
}

function firstNonNil(...values) {
  for (const value of values) {
    if (value != null) {
      return value;
    }
  }
  return null;
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value !== 'string') {
      continue;
    }
    const trimmed = value.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return '';
}

function ensureStreamToolCallID(idStore, index) {
  if (!(idStore instanceof Map)) {
    return `call_${newCallID()}`;
  }
  const key = Number.isInteger(index) ? index : 0;
  const existing = idStore.get(key);
  if (existing) {
    return existing;
  }
  const next = `call_${newCallID()}`;
  idStore.set(key, next);
  return next;
}

function newCallID() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '');
  }
  return `${Date.now()}${Math.floor(Math.random() * 1e9)}`;
}

module.exports = {
  formatOpenAIStreamToolCalls,
};
