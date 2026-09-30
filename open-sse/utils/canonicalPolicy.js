// Canonical Attempt Policy Engine (Phase 2 / G2-A).
//
// PURE layer #3 of the post-Canonical-Attempt architecture:
//   1. canonicalAttempt           — evidence (WHAT happened)        [Commits A–F]
//   2. classifyCanonicalAttempt   — classification + reason         [G1 / f02aaf7]
//   3. decideAttemptPolicy        — operational instruction         [THIS FILE]
//   4. consumers (Combo/executor/health) execute instructions       [G2-C/D+, later]
//
// This module ONLY calculates policy. It MUST NOT:
//   - record health samples / breaker success-failure / mark accounts unavailable;
//   - trigger retry / fallback / candidate progression;
//   - mutate Combo, canonicalAttempt, provider, or account state;
//   - perform I/O, network, or global/time/random access.
// Same input → identical output. O(1).

export const ATTEMPT_POLICY_FIELDS = Object.freeze([
  "fallbackEligible",
  "retryable",
  "healthAction",
  "stopProgression",
]);

const HEALTH_NONE = Object.freeze({ sample: "none", availability: "none", reason: null });

// Shared policy atoms — kept as frozen constants so determinism is structural
// (same object identity for identical rows) and the field bound is enforced by
// construction. Consumers receive these as instructions; they never mutate.

const POLICY = {
  // success — provider served a logically successful response.
  success: Object.freeze({
    fallbackEligible: false,
    retryable: false,
    healthAction: Object.freeze({ sample: "success", availability: "none", reason: null }),
    stopProgression: true,
  }),

  // transport_failure — HTTP transport did not succeed. Sub-cases by reason.
  userError: Object.freeze({ // http_400 / http_422 (and the existing non-retryable client set)
    fallbackEligible: false,
    retryable: false,
    healthAction: HEALTH_NONE,
    stopProgression: true,
  }),
  authFailure: Object.freeze({ // http_401 / http_403
    fallbackEligible: true,
    retryable: false,
    healthAction: Object.freeze({ sample: "failure", availability: "unavailable", reason: "auth" }),
    stopProgression: false,
  }),
  http404: Object.freeze({
    fallbackEligible: true,
    retryable: false,
    healthAction: Object.freeze({ sample: "failure", availability: "none", reason: null }),
    stopProgression: false,
  }),
  rateLimited: Object.freeze({ // http_429
    fallbackEligible: true,
    retryable: true,
    healthAction: Object.freeze({ sample: "failure", availability: "unavailable", reason: "cooldown" }),
    stopProgression: false,
  }),
  http5xx: Object.freeze({
    fallbackEligible: true,
    retryable: true,
    healthAction: Object.freeze({ sample: "failure", availability: "unavailable", reason: "transient" }),
    stopProgression: false,
  }),
  // Unmatched transport failure — conservative default (§7 hardening).
  // G1 maps all ≥500 to http_5xx and 429 to http_429, so this only reaches
  // unknown 4xx. isRetryableFailure returns false for those → retryable=false.
  // checkFallbackError default → shouldFallback:true + transient cooldown, and
  // markAccountUnavailable IS called (transient), so availability:unavailable.
  // Never retryable without evidence (the executor's resolveRetryEntry would
  // have no retry config for an unknown status anyway).
  transportDefault: Object.freeze({
    fallbackEligible: true,
    retryable: false,
    healthAction: Object.freeze({ sample: "failure", availability: "unavailable", reason: "transient" }),
    stopProgression: false,
  }),

  // provider_failure — transport succeeded but the provider's own response failed.
  providerError: Object.freeze({ // provider_error / response.failed
    fallbackEligible: true,
    retryable: false,
    healthAction: Object.freeze({ sample: "failure", availability: "none", reason: null }),
    stopProgression: false,
  }),
  malformed: Object.freeze({ // malformed_json / malformed_sse
    fallbackEligible: true,
    retryable: false,
    healthAction: Object.freeze({ sample: "failure", availability: "none", reason: "malformed" }),
    stopProgression: false,
  }),

  // empty_output — 200 with no usable model output. NOT a health signal.
  emptyOutput: Object.freeze({
    fallbackEligible: true,
    retryable: true,
    healthAction: HEALTH_NONE,
    stopProgression: false,
  }),

  // incomplete — output observed but successful completion not established.
  finishReasonLength: Object.freeze({ // user/client output-length boundary
    fallbackEligible: true,
    retryable: false,
    healthAction: HEALTH_NONE,
    stopProgression: false,
  }),
  noSuccessfulTerminal: Object.freeze({ // possibly transient
    fallbackEligible: true,
    retryable: true,
    healthAction: Object.freeze({ sample: "failure", availability: "none", reason: null }),
    stopProgression: false,
  }),

  // cancelled — client abort OR provider cancellation.
  clientAbort: Object.freeze({
    fallbackEligible: false,
    retryable: false,
    healthAction: HEALTH_NONE,
    stopProgression: true,
  }),
  providerCancelled: Object.freeze({
    fallbackEligible: true,
    retryable: false,
    healthAction: HEALTH_NONE,
    stopProgression: false,
  }),

  // cache / bypass — not provider attempts; never touch health/fallback.
  synthetic: Object.freeze({
    fallbackEligible: false,
    retryable: false,
    healthAction: HEALTH_NONE,
    stopProgression: true,
  }),

  // Defensive default for an unclassifiable provider attempt — do NOT mark
  // unavailable (§16: never turn missing evidence into provider unavailability).
  unknownProvider: Object.freeze({
    fallbackEligible: true,
    retryable: false,
    healthAction: Object.freeze({ sample: "failure", availability: "none", reason: null }),
    stopProgression: false,
  }),
};

/**
 * Decide the operational policy for a finalized canonical attempt.
 *
 * @param {object|null} attempt - finalized canonicalAttempt (carries G1
 *   `classification` + `reason` + `source`).
 * @returns {object|null} policy result, or null when attempt is null.
 *
 * Purity: no I/O, no globals, no Date/random, no mutation. Deterministic.
 */
export function decideAttemptPolicy(attempt) {
  if (!attempt) return null;

  // §7/§14: source precedence — cache/bypass never touch provider health.
  if (attempt.source === "cache" || attempt.source === "bypass") {
    return POLICY.synthetic;
  }

  const classification = attempt.classification;
  const reason = attempt.reason;

  switch (classification) {
    case "success":
      return POLICY.success;

    case "cancelled":
      // §13: client vs provider cancellation, distinguished by reason/evidence.
      if (reason === "client_abort") return POLICY.clientAbort;
      return POLICY.providerCancelled;

    case "transport_failure":
      return transportPolicy(reason);

    case "provider_failure":
      return providerFailurePolicy(reason);

    case "empty_output":
      // §11: both reasons share the same policy; the distinction is provenance.
      return POLICY.emptyOutput;

    case "incomplete":
      if (reason === "finish_reason_length") return POLICY.finishReasonLength;
      return POLICY.noSuccessfulTerminal;

    default:
      // Unknown classification on a provider attempt — safe default (no lock).
      return POLICY.unknownProvider;
  }
}

function transportPolicy(reason) {
  // §9: do NOT collapse all transport failures into one policy.
  switch (reason) {
    case "http_400":
    case "http_405":
    case "http_406":
    case "http_413":
    case "http_415":
    case "http_422":
      // Non-retryable client/request errors (combo.js nonRetryableClientError list).
      // Same invalid request → same invalid result on another provider; don't
      // fallback, don't retry, don't poison provider health.
      return POLICY.userError;
    case "http_401":
    case "http_403":
      return POLICY.authFailure;
    case "http_404":
      return POLICY.http404;
    case "http_429":
      return POLICY.rateLimited;
    case "http_5xx":
      return POLICY.http5xx;
    default:
      // Unknown transport reason — G1 maps all ≥500 to http_5xx and 429 to
      // http_429, so this only reaches unknown 4xx (410/418/426/451/…).
      // isRetryableFailure returns false for non-429/non-5xx → retryable=false.
      // checkFallbackError default → shouldFallback:true + transient cooldown.
      // markAccountUnavailable IS called (transient). Hardened from the original
      // retryable=true (which claimed retryability the executor never provides).
      return POLICY.transportDefault;
  }
}

function providerFailurePolicy(reason) {
  switch (reason) {
    case "malformed_json":
    case "malformed_sse":
      return POLICY.malformed;
    case "provider_error":
    case "response.failed":
    default:
      return POLICY.providerError;
  }
}
