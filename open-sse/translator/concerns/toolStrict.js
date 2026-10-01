// Function-tool `strict` handling across OpenAI wire formats.
//
// The same omitted field means different things per format:
// - Chat Completions: omitted `strict` = non-strict (optional properties stay optional).
// - Responses: omitted `strict` = the API normalizes the schema into strict mode when
//   possible, so every property becomes required and the model must invent values
//   for optional ones (e.g. `"id": ""`). Explicit `false` and `null` both opt out;
//   `true` on a schema with optional properties is rejected with 400.
//
// Rule: going through the router must give the same result as calling the target
// directly with the source format's own semantics.

// Values a client may declare. `null` is sent by LangChain to opt out of strict mode.
function isDeclaredStrict(value) {
  return typeof value === "boolean" || value === null;
}

function hasOwn(obj, key) {
  return !!obj && typeof obj === "object" && Object.prototype.hasOwnProperty.call(obj, key);
}

// Read the declared `strict` from a flat Responses tool or a nested Chat tool.
// Returns undefined when the client did not declare one.
export function readToolStrict(tool) {
  if (hasOwn(tool, "strict") && isDeclaredStrict(tool.strict)) return tool.strict;
  const fn = tool?.function;
  if (hasOwn(fn, "strict") && isDeclaredStrict(fn.strict)) return fn.strict;
  return undefined;
}

// Chat -> Responses: an omitted (or null) Chat `strict` is non-strict, which on
// Responses has to be spelled out as `false`.
export function chatStrictForResponses(fn) {
  return typeof fn?.strict === "boolean" ? fn.strict : false;
}

// Responses/Claude -> Chat: only booleans carry over (spread into the function).
// `null` and omitted both mean non-strict on Chat, so the field is left out
// instead of leaking `null` to Chat providers.
export function chatStrictFrom(tool) {
  return typeof tool?.strict === "boolean" ? { strict: tool.strict } : {};
}

// Re-attach a strict value captured with readToolStrict() after a tool rebuild.
// Undeclared stays absent so native Responses clients keep native semantics.
export function restoreToolStrict(tool, strict) {
  if (strict !== undefined) tool.strict = strict;
  return tool;
}
