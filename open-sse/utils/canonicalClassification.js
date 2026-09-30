// Commit G1: Canonical Attempt Outcome Classification.
//
// PURE layer #2 of the post-Canonical-Attempt architecture:
//   1. canonicalAttempt  — evidence (WHAT happened)        [Commits A–F]
//   2. classifyCanonicalAttempt — outcome class (WHY it ended)  [THIS FILE]
//   3. policy (fallback/retry/health/routing)            — later commits (G2+)
//
// This module ONLY classifies. It has no side effects, no I/O, no Response
// access, no network, no global state. It never triggers fallback/retry/health.
// It derives its answer exclusively from the FINAL canonicalAttempt evidence
// (Commit F established that streaming classification must use the finalized
// holder, never the provisional pre-flush state).
//
// Strictly excluded as classification inputs (§4): HTTP status alone, Response.ok,
// ChatResult.success, emitted/recvLines/eventLines counters, model/provider name
// heuristics, raw response bodies.

export const ATTEMPT_CLASSIFICATIONS = Object.freeze([
  "success",
  "transport_failure",
  "provider_failure",
  "empty_output",
  "incomplete",
  "cancelled",
]);

// Deterministic precedence. FIRST match wins — order encodes the ranking:
//   1. cancelled           — client abort OR provider cancellation (distinct
//                            from any failure; §12).
//   2. transport_failure   — HTTP <200|≥300|null transport. A failed transport
//                            means no trusted provider semantic response exists
//                            yet (§13); nothing below can override it.
//   3. provider_failure    — explicit provider/parse failure evidence
//                            (completionState="failure", errorSeen, or a failure
//                            completionType). Distinct from transport (§13): a 200
//                            with a provider error envelope or malformed-only SSE
//                            is provider_failure, never transport_failure.
//   4. empty_output        — logicalSuccess=false AND no usable model output
//                            observed (usage-only / empty choices / empty content /
//                            DONE-only / valid empty 200). Distinct from incomplete
//                            (§10): nothing useful was produced.
//   5. incomplete          — usable output observed BUT successful completion was
//                            not established (text+EOF no terminal, finish_reason=
//                            length, explicit incomplete terminal).
//   6. success             — logicalSuccess=true. Must be last (§11: never hide a
//                            non-logical-success state behind HTTP 200).
function classifyCanonicalAttempt(attempt) {
  if (!attempt) {
    // Null canonicalAttempt => no canonical provider attempt existed
    // (pre-provider validation / cache-before-adapter / bypass-before-adapter).
    // Never fabricate a failure class for it (§14).
    return null;
  }

  const {
    completionState,
    transportOk,
    abortSeen,
    errorSeen,
    completionType,
    usableOutput,
    logicalSuccess,
  } = attempt;

  // 1. Cancellation (client abort OR provider cancellation).
  if (abortSeen === true || completionState === "cancelled") {
    return {
      classification: "cancelled",
      reason: abortSeen ? "client_abort" : "provider_cancelled",
    };
  }

  // 2. Transport failure — HTTP transport did not succeed. Nothing below can be
  //    trusted as a provider semantic response because the transport itself broke.
  if (transportOk === false) {
    return {
      classification: "transport_failure",
      reason: transportReason(completionType, attempt?.responseStatus, "transport"),
    };
  }

  // 3. Explicit provider / parse failure. A 200 may still carry a provider error
  //    envelope, or the parse layer may have produced a malformed-only stream.
  //    Distinguish from transport: here transportOk is true.
  if (completionState === "failure" || errorSeen === true || completionType === "malformed_sse") {
    return {
      classification: "provider_failure",
      reason: providerReason(completionType, attempt),
    };
  }

  // 4. Empty output — no usable model output, no successful completion.
  if (logicalSuccess !== true && usableOutput !== true) {
    return {
      classification: "empty_output",
      reason: emptyReason(attempt),
    };
  }

  // 5. Incomplete — usable output exists but successful completion unestablished.
  if (completionState === "incomplete") {
    return {
      classification: "incomplete",
      reason: incompleteReason(attempt),
    };
  }

  // 6. Success — finalized logical success.
  if (logicalSuccess === true) {
    return { classification: "success", reason: null };
  }

  // Defensive: evidence is insufficient to place into a stronger class.
  // Should be rare given the axes above; keep it bounded + non-sensitive.
  return { classification: "incomplete", reason: "no_successful_terminal" };
}

// ── reason helpers ──────────────────────────────────────────────────────────
// All deterministic, short, evidence-backed, non-sensitive (§16). No raw body,
// prompt, key, cookie, or provider payload.

function transportReason(completionType, responseStatus, fallback) {
  if (typeof completionType === "string" && completionType.startsWith("http") && completionType !== "http_error") {
    return completionType; // e.g. http_5xx, http_401, http_error-from-forced-sse
  }
  if (Number.isFinite(responseStatus)) {
    return responseStatus >= 500 ? "http_5xx" : `http_${responseStatus}`;
  }
  return fallback;
}

function providerReason(completionType, attempt) {
  if (completionType === "malformed_sse") return "malformed_sse";
  if (completionType === "json_parse_error") return "malformed_json";
  if (completionType === "response.failed") return "provider_error";
  if (typeof completionType === "string" && completionType.startsWith("http")) return completionType;
  if (attempt?.responseStatus && attempt.responseStatus >= 400) {
    return `http_${attempt.responseStatus}`;
  }
  return "provider_error";
}

function emptyReason(attempt) {
  if (attempt?.hasUsage || attempt?.usagePresent) return "usage_only";
  return "empty_response";
}

function incompleteReason(attempt) {
  const fr = attempt?.finishReason;
  if (fr === "length") return "finish_reason_length";
  if (attempt?.completionType === "response.incomplete") return "provider_incomplete";
  return "no_successful_terminal";
}

export { classifyCanonicalAttempt };
