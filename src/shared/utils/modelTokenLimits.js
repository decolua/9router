const CONTEXT_KEYS = [
  "context_length",
  "contextWindow",
  "contextLength",
  "max_input_tokens",
  "maxInputTokens",
  "inputTokenLimit",
  "max_context_window_tokens",
  "context_window",
  "context",
];

const OUTPUT_KEYS = [
  "maxOutput",
  "max_output_tokens",
  "maxOutputTokens",
  "max_completion_tokens",
  "outputTokenLimit",
  "output",
];

function firstPresent(objects, keys) {
  for (const object of objects) {
    if (!object || typeof object !== "object") continue;
    for (const key of keys) {
      if (object[key] !== undefined && object[key] !== null && object[key] !== "") {
        return { present: true, value: object[key] };
      }
    }
  }
  return { present: false, value: undefined };
}

function limitSources(input) {
  return [
    input?.caps,
    input,
    input?.limit,
    input?.limits,
    input?.capabilities?.limits,
    input?.capabilities,
  ];
}

function positiveInteger(value, coerceStrings = false) {
  const number = coerceStrings && typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

export function validateModelLimits(input = {}) {
  const sources = limitSources(input);
  const context = firstPresent(sources, CONTEXT_KEYS);
  const output = firstPresent(sources, OUTPUT_KEYS);
  const limits = {};
  const errors = new Set();

  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    for (const key of CONTEXT_KEYS) {
      if (source[key] !== undefined && source[key] !== null && source[key] !== ""
        && positiveInteger(source[key]) === undefined) {
        errors.add("contextWindow must be a positive integer");
      }
    }
    for (const key of OUTPUT_KEYS) {
      if (source[key] !== undefined && source[key] !== null && source[key] !== ""
        && positiveInteger(source[key]) === undefined) {
        errors.add("maxOutput must be a positive integer");
      }
    }
  }

  if (context.present) {
    const value = positiveInteger(context.value);
    if (value === undefined) errors.add("contextWindow must be a positive integer");
    else limits.contextWindow = value;
  }
  if (output.present) {
    const value = positiveInteger(output.value);
    if (value === undefined) errors.add("maxOutput must be a positive integer");
    else limits.maxOutput = value;
  }

  return { limits, errors: Array.from(errors) };
}

export function normalizeModelLimits(input = {}) {
  const sources = limitSources(input);
  const context = firstPresent(sources, CONTEXT_KEYS);
  const output = firstPresent(sources, OUTPUT_KEYS);
  const limits = {};
  if (context.present) {
    const value = positiveInteger(context.value, true);
    if (value !== undefined) limits.contextWindow = value;
  }
  if (output.present) {
    const value = positiveInteger(output.value, true);
    if (value !== undefined) limits.maxOutput = value;
  }
  return limits;
}

export function applyModelLimitsToCaps(fallbackCaps = {}, explicit = {}) {
  return { ...fallbackCaps, ...normalizeModelLimits(explicit) };
}

export function withoutModelLimits(caps = {}) {
  const { contextWindow: _contextWindow, maxOutput: _maxOutput, ...rest } = caps || {};
  return rest;
}

export function normalizeDiscoveredModel(model) {
  if (!model || typeof model !== "object") return model;
  const limits = normalizeModelLimits(model);
  if (Object.keys(limits).length === 0) return model;
  return { ...model, caps: { ...(model.caps || {}), ...limits } };
}

export function normalizeDiscoveredModels(models) {
  return Array.isArray(models) ? models.map(normalizeDiscoveredModel) : [];
}

export function modelLimitsForOpenAI(model = {}) {
  const { contextWindow, maxOutput } = normalizeModelLimits(model);
  return {
    ...(contextWindow !== undefined
      ? { context_length: contextWindow, max_input_tokens: contextWindow }
      : {}),
    ...(maxOutput !== undefined
      ? { max_output_tokens: maxOutput, max_completion_tokens: maxOutput }
      : {}),
  };
}
