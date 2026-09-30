// Universal Canonical Attempt — contract + pure semantics (Phase 2 / Commit A).
//
// One provider-agnostic internal result that can represent ANY provider
// execution path — streaming, forced SSE→JSON, non-streaming JSON, transport
// failure, cache, bypass — WITHOUT treating transport success, stream
// completion, usage, or HTTP 200 as model success.
//
// Axes (deliberately separated, never conflated):
//   transport  transportOk: boolean|null — HTTP status is 2xx.
//              true  → transport is 2xx (successful).
//              false → transport is known non-2xx (transport failure).
//              null  → transport status NOT available / not applicable
//                      (e.g. synthetic sources without a real upstream HTTP
//                      exchange). null is NEVER coerced to false.
//   output     hasText/hasReasoning/
//              hasToolCall/
//              hasStructuredOutput     — semantic model-output evidence.
//              hasUsage                 — METADATA only, never output.
//   completion completionState          — how the provider attempt ended
//              (universal), vs terminalState (streaming-only evidence).
//   stream-    streamStarted, eofSeen, terminalType, finishReason
//   evidence
//   lifecycle  errorSeen, abortSeen
//   derived    usableOutput, logicalSuccess, outcome
//
// Source: "provider" | "cache" | "bypass". Orchestration strategies (combo,
// fusion, swarm, routing) are NOT attempt sources.
//
// Nullability: stream-specific fields are `null` when the concept does not
// apply to the path (non-streaming / cache / bypass). `false` means evidence
// WAS observed and it is false; `null` means not applicable / not observed.
// Never substitute false for null.

import { classifyCanonicalAttempt } from "./canonicalClassification.js";
import { decideAttemptPolicy } from "./canonicalPolicy.js";

const COMPLETION_STATES = Object.freeze(["success", "failure", "incomplete", "cancelled", "unknown"]);
const SOURCES = Object.freeze(["provider", "cache", "bypass"]);
const OUTCOMES = Object.freeze(["success", "failure", "incomplete", "cancelled"]);

/**
 * Universal completion semantics.
 *
 * completionState describes HOW the provider attempt ended, not whether the
 * HTTP request returned 2xx, not whether bytes arrived, and not whether a
 * usable answer exists:
 *
 *   success     — the attempt completed normally (streaming: a successful
 *                 provider terminal; non-streaming adapters: implicit 2xx
 *                 completion). NOTE: completionState=success does NOT imply a
 *                 model answer exists — usage-only can complete successfully
 *                 while usableOutput stays false.
 *   failure     — provider-declared failure terminal OR stream-level error.
 *   incomplete  — the attempt ended without success, without declared
 *                 failure, and without cancellation (EOF without terminal;
 *                 explicit incomplete terminal like finish_reason=length).
 *   cancelled   — provider cancellation OR client abort (evidence preserved
 *                 separately: terminalState='cancelled' vs abortSeen).
 *   unknown     — defensive: no evidence path ran.
 *
 * Never derived from transportOk alone, hasUsage, or emitted telemetry.
 */
export function deriveCompletionState(state) {
  if (!state) return "unknown";

  if (state.abortSeen) return "cancelled";
  if (state.terminalState === "cancelled") return "cancelled";
  if (state.terminalState === "success") return "success";
  if (state.terminalState === "failure" || state.errorSeen) return "failure";
  if (state.terminalState === "incomplete") return "incomplete";

  // No terminal evidence: stream reached EOF (or ended) without completing.
  if (state.eofSeen || state.terminalSeen) return "incomplete";

  return "unknown";
}

/**
 * Pure semantic model: was meaningful model output observed?
 * text OR reasoning OR tool call OR structured output. NEVER usage,
 * terminal markers, completion state, or telemetry counters.
 */
export function deriveUsableOutput(state) {
  if (!state) return false;
  return !!(state.hasText || state.hasReasoning || state.hasToolCall || state.hasStructuredOutput);
}

/**
 * Pure semantic model: did the attempt complete logically successfully?
 *
 *   usableOutput AND completionState==='success' AND !errorSeen AND !abortSeen.
 *
 * Explicitly NOT granted by transportOk, streamStarted, emitted>0, usage,
 * or [DONE] alone. abortSeen is kept explicit even though it implies
 * completionState='cancelled' — defensive and self-documenting.
 *
 * NOTE on the relationship between completionState and logicalSuccess:
 * completionState describes how the attempt ENDED; logicalSuccess additionally
 * requires that the attempt PRODUCED usable output. They are intentionally
 * different: 200 + usage-only can be completionState='success' while
 * logicalSuccess=false. Do not collapse them into one boolean.
 */
export function deriveLogicalSuccess(state) {
  if (!state) return false;
  if (!deriveUsableOutput(state)) return false;
  if (deriveCompletionState(state) !== "success") return false;
  if (state.errorSeen) return false;
  if (state.abortSeen) return false;
  return true;
}

/**
 * Canonical operational summary — always one of the four operational
 * outcomes. `unknown` lives on completionState (the defensive no-evidence
 * state), never on outcome: the evidence checks below are exhaustive over
 * the documented states.
 */
export function deriveOutcome(state) {
  if (!state) return "incomplete";
  const completion = deriveCompletionState(state);
  if (completion === "cancelled") return "cancelled";
  if (completion === "failure") return "failure";
  if (deriveLogicalSuccess(state)) return "success";
  return "incomplete";
}

/**
 * Build the UNIVERSAL canonical attempt object. Purely semantic and
 * side-effect free; the only integration inputs are the already-observed
 * state and transport metadata (status number — never clones/consumes a body).
 *
 * SOURCE-AWARE semantics (explicit evidence → source-specific fallback →
 * defensive incomplete/unknown; never fabricated):
 *
 *   source="provider" — normal streaming evidence path, unchanged.
 *
 *   source="cache"    — a semantic-cache hit means a cached Response exists
 *                       that was itself a valid (successfully derived) model
 *                       response at store time. The cache lookup returns a
 *                       2xx Response OR a failure-like result; there is NO
 *                       stream state by construction.
 *                       Valid cache hit (2xx): completionState=success,
 *                       completionType="cache", logicalSuccess=true,
 *                       usableOutput=true, stream-only fields null.
 *                       Non-2xx / failed cache result: completionState=failure,
 *                       logicalSuccess=false.
 *                       Output-category evidence (hasText etc.) is NOT
 *                       manufactured — usableOutput=true comes from the cached
 *                       Response being a valid model response, not from
 *                       invented content fields.
 *
 *   source="bypass"   — synthetic gateway response (warmup/skip/title). It is
 *                       a completed, valid response by construction; no stream
 *                       evidence exists. completionState=success with
 *                       completionType="bypass", logicalSuccess=true,
 *                       usableOutput=true. Stream-only fields stay null.
 *                       A failed bypass (error Response) maps to
 *                       completionState=failure, logicalSuccess=false.
 *
 * @param {object|null} state   - streaming state (createStreamState) or null
 *        for paths without stream evidence (cache/bypass/non-streaming).
 * @param {{status?: number|null, source?: "provider"|"cache"|"bypass"}} [opts]
 * @returns {object} canonicalAttempt
 */
export function createCanonicalAttempt(state = null, opts = {}) {
  const source = SOURCES.includes(opts.source) ? opts.source : "provider";
  // transportOk: boolean | null — see the explicit contract. null only when
  // status is absent/unknown; never coerced to false.
  const transportOk = opts.status == null ? null : opts.status >= 200 && opts.status < 300;

  // Source-specific completion defaults — applied ONLY when no streaming
  // evidence exists (state absent for external sources). Provider semantics
  // are untouched.
  let completionState = deriveCompletionState(state);
  let completionType = state?.terminalType ?? (source === "cache" ? "cache" : source === "bypass" ? "bypass" : null);
  let usableOutput = deriveUsableOutput(state);

  if (!state && (source === "cache" || source === "bypass")) {
    const okSynthetic = transportOk !== false; // null status treated as presumed-ok (gateway controls it)
    completionState = okSynthetic ? "success" : "failure";
    completionType = source;
    // A synthetic cached/bypass Response IS usable model output (it was a
    // valid response at construction/store). No content-category fields are
    // invented — the semantic comes from the Response validity, documented.
    usableOutput = okSynthetic;
  }

  const attempt = {
    source,
    transportOk,
    streamStarted: state ? state.streamStarted : null,
    hasText: state?.hasText ?? false,
    hasReasoning: state?.hasReasoning ?? false,
    hasToolCall: state?.hasToolCall ?? false,
    hasStructuredOutput: state?.hasStructuredOutput ?? false,
    hasUsage: state?.hasUsage ?? false,
    completionState,
    completionType,
    terminalState: state?.terminalState ?? null,
    terminalType: state?.terminalType ?? null,
    finishReason: state?.finishReason ?? null,
    eofSeen: state ? state.eofSeen : null,
    errorSeen: state?.errorSeen ?? false,
    abortSeen: state?.abortSeen ?? false,
    usableOutput,
    logicalSuccess: deriveLogicalSuccessFrom(state, completionState, usableOutput),
    outcome: deriveOutcomeFrom(state, completionState, usableOutput),
  };

  // G1: deterministic outcome classification (layer #2), computed from the
  // FINAL evidence only. Additive; never changes the semantic fields above.
  const classification = classifyCanonicalAttempt({
    ...attempt,
    responseStatus: opts.status ?? null,
  });
  const attemptWithClassification = { ...attempt, ...(classification || {}) };

  // G2-B: operational policy (layer #3), attached once. Purely additive and
  // never feeds back into the semantic/evidence layers.
  return {
    ...attemptWithClassification,
    policy: decideAttemptPolicy(attemptWithClassification),
  };
}

function deriveLogicalSuccessFrom(state, completionState, usableOutput) {
  if (!state) {
    // Synthetic cache/bypass: usableOutput true signals a valid cached/bypass
    // response; otherwise (failure/unknown) not logically successful.
    return usableOutput === true;
  }
  if (!usableOutput) return false;
  if (completionState !== "success") return false;
  if (state.errorSeen) return false;
  if (state.abortSeen) return false;
  return true;
}

function deriveOutcomeFrom(state, completionState, usableOutput) {
  // `completionState` is already source-aware (cache/bypass failure → "failure",
  // so outcome follows; no need to re-derive from state here).
  if (completionState === "cancelled") return "cancelled";
  if (completionState === "failure") return "failure";
  if (deriveLogicalSuccessFrom(state, completionState, usableOutput)) return "success";
  return "incomplete";
}

export { COMPLETION_STATES, SOURCES, OUTCOMES };
