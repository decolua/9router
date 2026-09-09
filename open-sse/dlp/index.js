// DLP masking engine — fail-open, mirrors open-sse/rtk conventions.
// Walk bodies in place, mask matching strings, never throw.

import { PATTERN_BY_ID } from "./patterns.js";
import { getPseudonym, getPseudonymForCustom, REDACT_LABEL } from "./pseudonyms.js";

const SKIP_KEYS = new Set([
  "model", "id", "role", "name", "type", "status", "object", "created",
  "index", "finish_reason", "tool_call_id", "provider", "owned_by",
  "stream", "encoding_format", "dimensions", "tool_choice",
]);
const MAX_STRING_LENGTH = 50_000;
const BASE64_HEURISTIC = /^[A-Za-z0-9+/=\s]+$/;

export function wildcardToRegex(pat) {
  return pat
    .split("*")
    .map((seg) => seg.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\?/g, "."))
    .join(".*");
}

function buildCustomRule(cp) {
  if (!cp || !cp.enabled || !cp.pattern) return null;
  if (cp.type === "wildcard") {
    return { id: cp.id, name: cp.name, custom: true, regex: new RegExp(wildcardToRegex(cp.pattern), "g") };
  }
  const flags = cp.flags || "";
  return { id: cp.id, name: cp.name, custom: true, regex: new RegExp(cp.pattern, flags.includes("g") ? flags : `${flags}g`) };
}

export function buildRules(types, customPatterns) {
  const rules = [];
  for (const id of types || []) {
    const def = PATTERN_BY_ID[id];
    if (def) rules.push(def);
  }
  for (const cp of customPatterns || []) {
    try {
      const rule = buildCustomRule(cp);
      if (rule) rules.push(rule);
    } catch {
      /* invalid custom pattern — skip (fail-open) */
    }
  }
  return rules;
}

export function maskText(text, { mode = "redact", types, customPatterns } = {}) {
  const made = { text, matched: 0, byType: {} };
  if (typeof text !== "string" || !text.length) return made;
  try {
    const rules = buildRules(types, customPatterns);
    if (!rules.length) return made;
    const tokens = new Map(); // private-use token -> final masked value
    let counter = 0;
    let out = text;
    for (const rule of rules) {
      try {
        out = out.replace(rule.regex, (match) => {
          if (rule.validate && !rule.validate(match)) return match;
          if (match.includes("\uE000")) return match; // never mask inside tokens
          const masked = mode === "redact" ? REDACT_LABEL
            : (rule.custom ? getPseudonymForCustom(match) : getPseudonym(rule.id, match));
          const token = `\uE000${counter++}\uE001`;
          tokens.set(token, masked);
          made.matched += 1;
          made.byType[rule.id] = (made.byType[rule.id] || 0) + 1;
          return token;
        });
      } catch {
        /* one rule failed — skip it, keep going (fail-open) */
      }
    }
    for (const [token, masked] of tokens) out = out.split(token).join(masked);
    made.text = out;
  } catch {
    /* never throw out of the request path */
  }
  return made;
}

function isBase64Like(s) {
  return s.length > 200 && BASE64_HEURISTIC.test(s);
}

export function maskSensitiveData(body, { enabled = true, mode = "redact", types, customPatterns } = {}) {
  if (!enabled || !body) return null;
  try {
    const ctx = { mode, types, customPatterns, stats: { matched: 0, byType: {} } };
    walkAndMask(body, ctx);
    return ctx.stats.matched > 0 ? ctx.stats : null;
  } catch {
    return null;
  }
}

// The walk carries a shared stats accumulator; the string branch below merges
// per-string results so maskSensitiveData reports the whole body.

function walkAndMask(value, ctx) {
  if (typeof value === "string") {
    if (value.length > MAX_STRING_LENGTH || isBase64Like(value)) return value;
    const r = maskText(value, ctx);
    if (r.matched > 0) {
      ctx.stats.matched += r.matched;
      for (const [k, v] of Object.entries(r.byType)) {
        ctx.stats.byType[k] = (ctx.stats.byType[k] || 0) + v;
      }
    }
    return r.text;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = walkAndMask(value[i], ctx);
    return value;
  }
  if (value && typeof value === "object") {
    for (const key of Object.keys(value)) {
      if (SKIP_KEYS.has(key)) continue;
      value[key] = walkAndMask(value[key], ctx);
    }
    return value;
  }
  return value;
}

export function testMask({ type = "regex", pattern, flags = "", sampleText = "" } = {}) {
  const result = { valid: true, error: null, matches: [], preview: sampleText };
  if (typeof sampleText !== "string" || !sampleText.length) return result;
  let re;
  try {
    re = type === "wildcard"
      ? new RegExp(wildcardToRegex(pattern), "g")
      : new RegExp(pattern, flags.includes("g") ? flags : `${flags}g`);
  } catch (e) {
    return { valid: false, error: e.message, matches: [], preview: sampleText };
  }
  let m;
  while ((m = re.exec(sampleText)) !== null) {
    if (m.index === re.lastIndex) re.lastIndex++;
    result.matches.push({ value: m[0], index: m.index, length: m[0].length });
  }
  let out = sampleText;
  for (let i = result.matches.length - 1; i >= 0; i--) {
    const mm = result.matches[i];
    out = out.slice(0, mm.index) + REDACT_LABEL + out.slice(mm.index + mm.length);
  }
  result.preview = out;
  return result;
}
