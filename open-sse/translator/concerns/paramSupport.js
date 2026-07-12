import { getCapabilitiesForModel } from "../../providers/capabilities.js";

// Strip request params a given provider/model rejects upstream (e.g. HTTP 400).
// Config-driven: add a rule instead of scattering `delete body.x` across executors.

// Each rule: optional provider, regex match on model, list of params to drop.
// A param is removed only when it is present (!== undefined).
// For Sakana we also need a conditional drop: drop reasoning_effort ONLY
// when its value is not in the Sakana-accepted enum {high, xhigh, max}.
const STRIP_RULES = [
  // claude-opus-4 series: temperature is deprecated (Anthropic 400). #1748
  { match: /claude-opus-4/i, drop: ["temperature"] },
  // GitHub Copilot gpt-5.4: temperature unsupported.
  { provider: "github", match: /gpt-5\.4/i, drop: ["temperature"] },
  // GitHub Copilot Claude (except opus/sonnet 4.6): thinking + reasoning_effort rejected. #713
  { provider: "github", match: (m) => /claude/i.test(m) && !/claude.*(opus|sonnet).*4\.6/i.test(m), drop: ["thinking", "reasoning_effort"] },
  // xAI Grok: reasoning_effort / reasoning / thinking rejected ("Model grok-build-0.1 does not support parameter reasoning")
  { provider: "xai", match: /grok/i, drop: ["reasoning_effort", "reasoning", "thinking"] },
  // Cloudflare Workers AI: content must be plain string, rejects OpenAI content-part array (#1926)
  { provider: "cloudflare-ai", flattenContent: true },
  // Sakana fugu / fugu-ultra / fugu-ultra-20260615:
  //   - reasoning_effort only accepts `high` | `xhigh` | `max`. Any other value
  //     is rejected by the API. Claude Code may send `low`/`medium`/`minimal`,
  //     so we drop it (Sakana will fall back to its own default — `high` for
  //     fugu, `xhigh` for fugu-ultra).
  //   - `reasoning` (object form) is similarly constrained.
  //   - `previous_response_id` is rejected by the Responses API shape; drop.
  // Match by model id (covers any 9router provider id that routes fugu).
  {
    match: /(^|\/)fugu(-ultra)?(-[0-9]+)?$/i,
    drop: ["previous_response_id"],
  },
  {
    match: /(^|\/)fugu(-ultra)?(-[0-9]+)?$/i,
    dropIfValueNotIn: { reasoning_effort: ["high", "xhigh", "max"] },
  },
  {
    match: /(^|\/)fugu(-ultra)?(-[0-9]+)?$/i,
    dropReasoningObjectUnless: { field: "reasoning", allow: ["high", "xhigh", "max"] },
  },
];

// Enforce minimum values for params (e.g. max_tokens floor).
// Each rule: optional provider, regex match on model, map of { param: minValue }.
// If the body param is undefined, it is left alone (we don't silently invent
// values; the upstream executor / client supplies defaults). If it is present
// but below the floor, it is bumped up to the minimum in place.
const MIN_RULES = [
  // Sakana fugu-ultra: rejects `max_tokens < 16` ("must be greater than or
  // equal to 16"). Also applies to the Responses API field `max_output_tokens`
  // and the legacy `max_completion_tokens`. Model id is the authoritative
  // signal here — covers openai-compatible-chat-<uuid> user configurations
  // that route fugu-ultra upstream.
  {
    match: /(^|\/)fugu(-ultra)?(-[0-9]+)?$/i,
    min: { max_tokens: 16, max_completion_tokens: 16, max_output_tokens: 16 },
  },
  { provider: "volcengine-ark", match: /glm-5/i, clampToModelMaxOutput: true },
  // VolcEngine Ark caps the Kimi family at max_tokens <= 32768, but the model's
  // advertised ceiling is far higher (Kimi-K2.7-Code resolves to maxOutput 262144),
  // so clampToModelMaxOutput alone leaves it uncapped and the request 400s with
  // "integer above maximum value, expected <= 32768". Pin an explicit endpoint cap;
  // min() with the model ceiling still applies if a variant's own limit is lower.
  { provider: "volcengine-ark", match: /kimi/i, maxOutputCap: 32768, clampToModelMaxOutput: true },
];

// Test a rule's match (regex or predicate) against the model id.
// Rules without `match` apply whenever the provider matches (or is unset).
// IMPORTANT: this falls through to `true` when neither `match` nor `provider`
// is present. Today every STRIP_RULES / MIN_RULES entry sets at least one, so
// the fallthrough is safe — but a future rule that sets neither would silently
// fire on every model. Add an explicit `match` (or a `provider` guard) on any
// new rule.
function matches(rule, model) {
  if (typeof rule.match === "function") return rule.match(model);
  if (rule.match instanceof RegExp) return rule.match.test(model);
  return true;
}

function clampNumber(body, key, ceiling) {
  if (typeof body[key] === "number" && Number.isFinite(body[key]) && body[key] > ceiling) {
    body[key] = ceiling;
  }
}

// Remove unsupported params from body in place; returns body.
export function stripUnsupportedParams(provider, model, body) {
  if (!model || !body || typeof body !== "object") return body;
  for (const rule of STRIP_RULES) {
    if (rule.provider && rule.provider !== provider) continue;
    if (!matches(rule, model)) continue;
    for (const key of rule.drop || []) {
      if (body[key] !== undefined) delete body[key];
    }
    // Conditional drop: remove key unless its value is in the allow-list.
    for (const [key, allowed] of Object.entries(rule.dropIfValueNotIn || {})) {
      if (body[key] !== undefined && !allowed.includes(body[key])) {
        delete body[key];
      }
    }
    // Conditional drop for object form: remove the object unless its inner
    // `effort` field is in the allow-list.
    if (rule.dropReasoningObjectUnless) {
      const { field, allow } = rule.dropReasoningObjectUnless;
      const obj = body[field];
      if (obj && typeof obj === "object" && !allow.includes(obj.effort)) {
        delete body[field];
      }
    }
    // CF Workers AI oneOf root schema only accepts content as plain string (#1926)
    if (rule.flattenContent && Array.isArray(body.messages)) {
      for (const msg of body.messages) {
        if (msg && Array.isArray(msg.content)) {
          msg.content = msg.content
            .map(b => (b?.type === "text" && typeof b.text === "string") ? b.text : "")
            .join("");
        }
      }
    }
    if (rule.clampToModelMaxOutput || Number.isFinite(rule.maxOutputCap)) {
      const modelCeiling = getCapabilitiesForModel(provider, model).maxOutput;
      const candidates = [];
      if (rule.clampToModelMaxOutput && Number.isFinite(modelCeiling) && modelCeiling > 0) {
        candidates.push(modelCeiling);
      }
      if (Number.isFinite(rule.maxOutputCap) && rule.maxOutputCap > 0) {
        candidates.push(rule.maxOutputCap);
      }
      if (candidates.length > 0) {
        const ceiling = Math.min(...candidates);
        clampNumber(body, "max_tokens", ceiling);
        clampNumber(body, "max_completion_tokens", ceiling);
        clampNumber(body, "max_output_tokens", ceiling);
      }
    }
  }
  return body;
}

// Clamp numeric params up to a model-specific floor in place; returns body.
// Pairs with stripUnsupportedParams — same rule shape, different action.
export function enforceParamMinimums(provider, model, body) {
  if (!model || !body || typeof body !== "object") return body;
  for (const rule of MIN_RULES) {
    if (rule.provider && rule.provider !== provider) continue;
    if (!matches(rule, model)) continue;
    for (const [key, minVal] of Object.entries(rule.min || {})) {
      if (typeof body[key] === "number" && body[key] < minVal) {
        body[key] = minVal;
      }
    }
  }
  return body;
}
