// Claude Code appends a bracketed context marker to the model name when the
// 1M-context beta is toggled on: `claude-opus-5` becomes `claude-opus-5[1m]`.
// The marker is a client-side annotation, not part of any model id: it never
// matches a combo name, an alias or a `provider/model` pair, so a request that
// carries it dies at model resolution with "Invalid model format".
//
// The capability itself travels in the `anthropic-beta: context-1m-2025-08-07`
// header, which is forwarded untouched — stripping the marker is enough to let
// the request route normally and still reach the upstream as a 1M request.

const CONTEXT_MARKER = /\[1m\]$/i;

// Returns { model, contextMarker } — contextMarker is null when there is none.
export function stripModelContextMarker(modelStr) {
  if (typeof modelStr !== "string") return { model: modelStr, contextMarker: null };
  const trimmed = modelStr.trim();
  const match = trimmed.match(CONTEXT_MARKER);
  if (!match) return { model: modelStr, contextMarker: null };
  return { model: trimmed.slice(0, -match[0].length), contextMarker: match[0].slice(1, -1).toLowerCase() };
}

// Apply (or clear) the 1M-context marker on a mapping value. Idempotent:
// strips any existing marker before appending, so repeated toggles cannot
// stack `[1m][1m]`.
export function withContextMarker(value, enabled) {
  const { model } = stripModelContextMarker(String(value ?? ""));
  return enabled ? `${model}[1m]` : model;
}

// Split a mapping value ("alias/model-id" or a bare model id) into
// { prefix, model }, with any [1m] marker removed first.
export function splitModelRef(value) {
  const { model } = stripModelContextMarker(String(value ?? "").trim());
  const slash = model.indexOf("/");
  if (slash === -1) return { prefix: null, model };
  return { prefix: model.slice(0, slash), model: model.slice(slash + 1) };
}

// Claude Code assumes a 200K window unless a model name carries the `[1m]`
// marker, so a 1M-window model is otherwise treated as 200K (clamping
// auto-compact and reading as "100% context used"). Decide whether a mapping
// value should carry the marker from the model's real context window.
// `resolveContextWindow(prefix, model)` is injected so this stays free of the
// capability registry (importable/testable anywhere).
export function shouldMarkOneMContext(value, resolveContextWindow) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return false;
  if (CONTEXT_MARKER.test(trimmed)) return false; // explicit marker already present
  const { prefix, model } = splitModelRef(trimmed);
  if (!model) return false;
  const window = resolveContextWindow?.(prefix, model);
  return Number.isFinite(window) && window >= 1000000;
}
