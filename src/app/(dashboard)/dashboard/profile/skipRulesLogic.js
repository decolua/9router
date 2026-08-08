import { SKIP_RULE_RETRY_ATTEMPTS_MIN } from "open-sse/services/accountFallback.js";

// Pure, framework-free helpers for the Skip-rules modal. Extracted from
// SkipRulesModal.js so they can be unit-tested without a JSX/React harness
// (the vitest env is "node" and cannot parse JSX imported from a .js file).

// Row model (editable form state):
//   { provider, matchMode: "http" | "kind",
//     status, contains,          // used when matchMode === "http" (either/both)
//     kind,                      // used when matchMode === "kind"
//     action, headerTimeoutMs, sweep, retryAttempts }
// Stored rule: { provider, match: { status?, contains?, kind? }, action, headerTimeoutMs?, sweep?, retryAttempts? }
// retryAttempts (retry only) = extra calls to the SAME account before moving on.
// A rule's match may carry any combination of status/contains/kind (AND at runtime).
// sweep (skip only) asks the account loop to re-try the whole pool after exhaustion.

// Convert stored rule → editable row.
export function ruleToRow(rule) {
  const m = rule.match || {};
  const matchMode = m.kind != null ? "kind" : "http";
  return {
    provider: rule.provider || "",
    matchMode,
    status: m.status != null ? String(m.status) : "",
    contains: m.contains != null ? String(m.contains) : "",
    kind: m.kind != null ? String(m.kind) : "connect_timeout",
    action: rule.action === "retry" ? "retry" : "skip",
    headerTimeoutMs: rule.headerTimeoutMs != null ? String(rule.headerTimeoutMs) : "",
    sweep: rule.sweep === true,
    // Blank for a retry rule saved before the field existed; rowToRule() then omits
    // it and accountFallback.resolveRetryAttempts() applies the documented default.
    retryAttempts: rule.retryAttempts != null ? String(rule.retryAttempts) : "",
  };
}

// Convert an editable row → stored rule. Returns { rule } when valid, or
// { error } with a human-readable reason so the caller can flag the exact row
// instead of silently dropping it.
export function rowToRule(row) {
  if (!row.provider) return { error: "Select a provider" };
  const match = {};

  if (row.matchMode === "kind") {
    if (!row.kind) return { error: "Select an error kind" };
    match.kind = row.kind;
  } else {
    // HTTP mode: status and/or contains — at least one required.
    const hasStatus = row.status != null && String(row.status).trim() !== "";
    const hasContains = row.contains != null && String(row.contains).trim() !== "";
    if (!hasStatus && !hasContains) {
      return { error: "Enter an HTTP status or matching text (at least one)" };
    }
    if (hasStatus) {
      const n = parseInt(row.status, 10);
      if (!Number.isInteger(n) || n < 100 || n > 599) return { error: "HTTP status must be an integer 100-599" };
      match.status = n;
    }
    if (hasContains) {
      const c = String(row.contains).trim();
      if (c.length > 200) return { error: "Matching text is too long (200 characters max)" };
      match.contains = c;
    }
  }

  const rule = { provider: row.provider, match, action: row.action === "retry" ? "retry" : "skip" };
  if (row.matchMode === "kind" && row.kind === "connect_timeout" && row.headerTimeoutMs) {
    const t = parseInt(row.headerTimeoutMs, 10);
    if (!Number.isInteger(t) || t < 1000 || t > 120000) return { error: "Header timeout must be an integer 1000-120000 ms" };
    rule.headerTimeoutMs = t;
  }
  // sweep (re-try whole pool after exhaustion) is only meaningful for skip.
  if (rule.action === "skip" && row.sweep === true) rule.sweep = true;
  // retryAttempts is only meaningful for retry. Switching a row Retry → Skip
  // therefore drops it, which is what the UI promises.
  if (rule.action === "retry" && row.retryAttempts != null && String(row.retryAttempts).trim() !== "") {
    const n = parseInt(row.retryAttempts, 10);
    if (!Number.isInteger(n) || n < SKIP_RULE_RETRY_ATTEMPTS_MIN) {
      return { error: `Retry count must be an integer >= ${SKIP_RULE_RETRY_ATTEMPTS_MIN}` };
    }
    rule.retryAttempts = n;
  }
  return { rule };
}

// Merge the static provider registry (AI_PROVIDERS) with dynamic compatible
// nodes from /api/provider-nodes so user-created providers (anthropic-compatible-<uuid>)
// appear in the dropdown. Deduped by id, static entries win.
export function mergeProviderOptions(aiProviders, nodes) {
  const staticOpts = Object.values(aiProviders || {})
    .filter(p => p && !p.hidden)
    .map(p => ({ value: p.id, label: p.name || p.id }));
  const nodeOpts = (nodes || []).map(n => ({ value: n.id, label: `${n.name || n.id} (${n.type || "custom"})` }));
  const seen = new Set();
  return [...staticOpts, ...nodeOpts].filter(o => {
    if (seen.has(o.value)) return false;
    seen.add(o.value);
    return true;
  });
}
