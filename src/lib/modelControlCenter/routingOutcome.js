/**
 * Canonical routing outcome attribution.
 *
 * Observer-only contract:
 * - no persistence
 * - no routing authority
 * - no request/response/auth payloads
 * - listener failure is fail-open
 */

const VALID_OUTCOMES =
  new Set([
    "success",
    "failure",
    "exception",
  ]);

const listeners =
  new Set();

export const ROUTING_OUTCOME_CONTRACT =
  Object.freeze({
    version: 1,

    persistence:
      "none",

    authority:
      "observer-only",

    failOpen:
      true,

    outcomes:
      Object.freeze([
        "success",
        "failure",
        "exception",
      ]),
  });

function cleanString(
  value,
  fallback = null,
) {
  if (
    typeof value !== "string"
  ) {
    return fallback;
  }

  const result =
    value.trim();

  return result
    || fallback;
}

function cleanPositiveInteger(
  value,
) {
  const number =
    Number(value);

  if (
    !Number.isInteger(number)
    || number < 1
  ) {
    return null;
  }

  return number;
}

function cleanStatus(
  value,
) {
  if (
    value === undefined
    || value === null
  ) {
    return null;
  }

  const number =
    Number(value);

  if (
    !Number.isInteger(number)
    || number < 100
    || number > 599
  ) {
    return null;
  }

  return number;
}

function cleanDurationMs(
  value,
) {
  const number =
    Number(value);

  if (
    !Number.isFinite(number)
    || number < 0
  ) {
    return null;
  }

  return Math.round(
    number,
  );
}

export function normalizeRoutingOutcome(
  event = {},
) {
  if (
    !event
    || typeof event !== "object"
    || Array.isArray(event)
  ) {
    return null;
  }

  const candidateModel =
    cleanString(
      event.candidateModel,
    );

  const outcome =
    cleanString(
      event.outcome,
    );

  const attemptIndex =
    cleanPositiveInteger(
      event.attemptIndex,
    );

  const attemptCount =
    cleanPositiveInteger(
      event.attemptCount,
    );

  if (
    !candidateModel
    || !VALID_OUTCOMES.has(outcome)
    || !attemptIndex
    || !attemptCount
    || attemptIndex > attemptCount
  ) {
    return null;
  }

  const isWinner =
    outcome === "success";

  return Object.freeze({
    v: 1,

    observedAt:
      new Date().toISOString(),

    routeKind:
      cleanString(
        event.routeKind,
        "chat",
      ),

    comboName:
      cleanString(
        event.comboName,
      ),

    strategy:
      cleanString(
        event.strategy,
        "fallback",
      ),

    candidateModel,

    attemptIndex,

    attemptCount,

    outcome,

    status:
      cleanStatus(
        event.status,
      ),

    isWinner,

    fallbackEligible:
      isWinner
        ? false
        : Boolean(
            event.fallbackEligible,
          ),

    durationMs:
      cleanDurationMs(
        event.durationMs,
      ),
  });
}

export function publishRoutingOutcome(
  event,
) {
  let normalized;

  try {
    normalized =
      normalizeRoutingOutcome(
        event,
      );
  } catch {
    return null;
  }

  if (!normalized) {
    return null;
  }

  for (
    const listener
    of listeners
  ) {
    try {
      listener(
        normalized,
      );
    } catch {
      // Observer failures must never affect routing.
    }
  }

  return normalized;
}

export function subscribeRoutingOutcomes(
  listener,
) {
  if (
    typeof listener !== "function"
  ) {
    return () => {};
  }

  listeners.add(
    listener,
  );

  return () => {
    listeners.delete(
      listener,
    );
  };
}
