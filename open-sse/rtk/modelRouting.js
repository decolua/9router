// Model Routing: route "simple" requests to a cheaper model than the one requested.
//
// MVP — rule-based classifier (no embeddings, no extra LLM call):
//   A request is "simple" when ALL of:
//     - no tools provided
//     - no image / multimodal content
//     - estimated input bytes ≤ simpleMaxBytes (default 4000)
//     - latest user message does not contain fenced code blocks or JSON-looking payloads
//     - no thinking/reasoning_effort override above "low"
//
// When simple AND a rule exists mapping `originalModel` → `cheapModel`, swap the model.
// When not simple AND a rule exists mapping `originalModel` → `strongModel` (optional),
// upgrade. Default behavior is downgrade-only — never upgrade unless explicitly configured.
//
// Rules format (from settings.modelRoutingRules):
//   { "<provider/model>": { cheap: "<provider/model>", strong: "<provider/model>" } }
//
// Returns { from, to, reason } when a swap is made, else null.
// Caller is responsible for re-parsing the routed model and re-fetching credentials.

const DEFAULT_SIMPLE_MAX_BYTES = 4000;
const CODE_FENCE = /```/;
const JSONISH = /^\s*[{\[]/m;

export function routeModel(body, originalModel, enabled, rulesObj = {}, opts = {}) {
  if (!enabled || !originalModel) return null;
  const rules = normalizeRules(rulesObj);
  const rule = rules[originalModel];
  if (!rule) return null;

  const simple = isSimpleRequest(body, opts.simpleMaxBytes ?? DEFAULT_SIMPLE_MAX_BYTES);
  const targetKey = simple ? "cheap" : "strong";
  const target = rule[targetKey];
  if (!target || target === originalModel) return null;

  return {
    from: originalModel,
    to: target,
    reason: simple ? "simple→cheap" : "complex→strong",
    classification: simple ? "simple" : "complex",
  };
}

function normalizeRules(rulesObj) {
  if (!rulesObj || typeof rulesObj !== "object") return {};
  const out = {};
  for (const [k, v] of Object.entries(rulesObj)) {
    if (!v || typeof v !== "object") continue;
    out[k] = {
      cheap: typeof v.cheap === "string" ? v.cheap.trim() : "",
      strong: typeof v.strong === "string" ? v.strong.trim() : "",
    };
  }
  return out;
}

function isSimpleRequest(body, maxBytes) {
  if (!body) return false;

  if (Array.isArray(body.tools) && body.tools.length > 0) return false;

  // thinking on → not simple
  if (body.thinking && body.thinking.type === "enabled") return false;
  const effort = body.reasoning_effort || body.reasoning?.effort;
  if (effort && effort !== "none" && effort !== "low") return false;

  const items = Array.isArray(body.messages) ? body.messages
    : Array.isArray(body.input) ? body.input
    : Array.isArray(body.contents) ? body.contents
    : null;

  let totalBytes = sizeOfString(body.system) + sizeOfString(body.instructions);
  if (items) {
    for (const m of items) {
      totalBytes += sizeOfMessage(m);
      if (hasMultimodal(m)) return false;
    }
  }
  if (totalBytes > maxBytes) return false;

  // Latest user text: code/JSON heuristics
  const lastUser = items ? findLastUserText(items) : "";
  if (!lastUser) return totalBytes > 0; // empty user → don't reroute
  if (CODE_FENCE.test(lastUser)) return false;
  if (JSONISH.test(lastUser) && lastUser.length > 200) return false;

  return true;
}

function sizeOfString(v) {
  return typeof v === "string" ? v.length : 0;
}

function sizeOfMessage(m) {
  if (!m) return 0;
  if (typeof m.content === "string") return m.content.length;
  if (Array.isArray(m.content)) {
    let s = 0;
    for (const b of m.content) {
      if (!b) continue;
      if (typeof b.text === "string") s += b.text.length;
      else if (typeof b.content === "string") s += b.content.length;
    }
    return s;
  }
  if (Array.isArray(m.parts)) {
    let s = 0;
    for (const p of m.parts) if (p && typeof p.text === "string") s += p.text.length;
    return s;
  }
  return 0;
}

function hasMultimodal(m) {
  if (!m) return false;
  if (!Array.isArray(m.content)) {
    if (Array.isArray(m.parts)) {
      for (const p of m.parts) {
        if (p && (p.inlineData || p.inline_data || p.fileData || p.file_data)) return true;
      }
    }
    return false;
  }
  for (const b of m.content) {
    if (!b) continue;
    if (b.type === "image" || b.type === "input_image" || b.type === "image_url") return true;
    if (b.source && (b.source.type === "base64" || b.source.media_type?.startsWith("image"))) return true;
  }
  return false;
}

function findLastUserText(items) {
  for (let i = items.length - 1; i >= 0; i--) {
    const m = items[i];
    if (!m || m.role !== "user") continue;
    if (typeof m.content === "string") return m.content;
    if (Array.isArray(m.content)) {
      let buf = "";
      for (const b of m.content) {
        if (b && typeof b.text === "string") buf += b.text + "\n";
      }
      if (buf) return buf;
    }
    if (Array.isArray(m.parts)) {
      let buf = "";
      for (const p of m.parts) if (p && typeof p.text === "string") buf += p.text + "\n";
      if (buf) return buf;
    }
  }
  return "";
}

export function formatRoutingLog(decision) {
  if (!decision) return null;
  return `[ROUTE] ${decision.from} → ${decision.to} (${decision.reason})`;
}
