const DEFAULT_MIN_ATTEMPTS =
  3;

const DEFAULT_HALF_LIFE_MS =
  15 * 60 * 1000;

const DEFAULT_STALE_AFTER_MS =
  60 * 60 * 1000;

const DEFAULT_ENTER_FAILURE_RATE =
  0.50;

const DEFAULT_RECOVER_FAILURE_RATE =
  0.25;

const DEFAULT_ENTER_RATE_LIMIT_RATE =
  0.50;

const DEFAULT_RECOVER_RATE_LIMIT_RATE =
  0.20;

const DEFAULT_ENTER_SERVER_FAILURE_RATE =
  0.50;

const DEFAULT_RECOVER_SERVER_FAILURE_RATE =
  0.20;


export const ROUTING_STABILITY_CONTRACT =
  Object.freeze({
    version: 1,

    authority:
      "advisory-only",

    persistence:
      "none",

    scoring:
      "none",

    routingIntegration:
      "none",

    states:
      Object.freeze([
        "neutral",
        "healthy",
        "degraded",
      ]),

    defaults:
      Object.freeze({
        minAttempts:
          DEFAULT_MIN_ATTEMPTS,

        halfLifeMs:
          DEFAULT_HALF_LIFE_MS,

        staleAfterMs:
          DEFAULT_STALE_AFTER_MS,

        enterFailureRate:
          DEFAULT_ENTER_FAILURE_RATE,

        recoverFailureRate:
          DEFAULT_RECOVER_FAILURE_RATE,

        enterRateLimitRate:
          DEFAULT_ENTER_RATE_LIMIT_RATE,

        recoverRateLimitRate:
          DEFAULT_RECOVER_RATE_LIMIT_RATE,

        enterServerFailureRate:
          DEFAULT_ENTER_SERVER_FAILURE_RATE,

        recoverServerFailureRate:
          DEFAULT_RECOVER_SERVER_FAILURE_RATE,
      }),
  });


function finiteNumber(
  value,
  fallback,
) {
  const number =
    Number(value);

  if (!Number.isFinite(number)) {
    return fallback;
  }

  return number;
}


function positiveNumber(
  value,
  fallback,
) {
  const number =
    finiteNumber(
      value,
      fallback,
    );

  if (number <= 0) {
    return fallback;
  }

  return number;
}


function positiveInteger(
  value,
  fallback,
) {
  const number =
    Number(value);

  if (
    !Number.isInteger(number)
    || number < 1
  ) {
    return fallback;
  }

  return number;
}


function rate(
  numerator,
  denominator,
) {
  if (
    !Number.isFinite(numerator)
    || !Number.isFinite(denominator)
    || denominator <= 0
  ) {
    return 0;
  }

  return Math.max(
    0,
    Math.min(
      1,
      numerator / denominator,
    ),
  );
}


function normalizePreviousState(
  value,
) {
  if (
    value === "healthy"
    || value === "degraded"
  ) {
    return value;
  }

  return "neutral";
}


function normalizeConfig(
  config = {},
) {
  const enterFailureRate =
    rate(
      finiteNumber(
        config.enterFailureRate,
        DEFAULT_ENTER_FAILURE_RATE,
      ),
      1,
    );

  const recoverFailureRate =
    Math.min(
      enterFailureRate,
      rate(
        finiteNumber(
          config.recoverFailureRate,
          DEFAULT_RECOVER_FAILURE_RATE,
        ),
        1,
      ),
    );

  const enterRateLimitRate =
    rate(
      finiteNumber(
        config.enterRateLimitRate,
        DEFAULT_ENTER_RATE_LIMIT_RATE,
      ),
      1,
    );

  const recoverRateLimitRate =
    Math.min(
      enterRateLimitRate,
      rate(
        finiteNumber(
          config.recoverRateLimitRate,
          DEFAULT_RECOVER_RATE_LIMIT_RATE,
        ),
        1,
      ),
    );

  const enterServerFailureRate =
    rate(
      finiteNumber(
        config.enterServerFailureRate,
        DEFAULT_ENTER_SERVER_FAILURE_RATE,
      ),
      1,
    );

  const recoverServerFailureRate =
    Math.min(
      enterServerFailureRate,
      rate(
        finiteNumber(
          config.recoverServerFailureRate,
          DEFAULT_RECOVER_SERVER_FAILURE_RATE,
        ),
        1,
      ),
    );

  return Object.freeze({
    minAttempts:
      positiveInteger(
        config.minAttempts,
        DEFAULT_MIN_ATTEMPTS,
      ),

    halfLifeMs:
      positiveNumber(
        config.halfLifeMs,
        DEFAULT_HALF_LIFE_MS,
      ),

    staleAfterMs:
      positiveNumber(
        config.staleAfterMs,
        DEFAULT_STALE_AFTER_MS,
      ),

    enterFailureRate,

    recoverFailureRate,

    enterRateLimitRate,

    recoverRateLimitRate,

    enterServerFailureRate,

    recoverServerFailureRate,
  });
}


function parseObservedAt(
  value,
) {
  if (
    typeof value !== "string"
  ) {
    return null;
  }

  const parsed =
    Date.parse(value);

  if (!Number.isFinite(parsed)) {
    return null;
  }

  return parsed;
}


function neutralResult({
  model,
  previousState,
  reason,
  attempts = 0,
  effectiveAttempts = 0,
  ageMs = null,
  decayFactor = 0,
  failureRate = 0,
  rateLimitedRate = 0,
  serverFailureRate = 0,
}) {
  return Object.freeze({
    v: 1,

    model,

    state:
      "neutral",

    previousState,

    transition:
      previousState === "neutral"
        ? "neutral"
        : "decay_to_neutral",

    reason,

    attempts,

    effectiveAttempts,

    ageMs,

    decayFactor,

    failureRate,

    rateLimitedRate,

    serverFailureRate,

    advisoryOnly:
      true,
  });
}


/**
 * Evaluate one model's bounded performance aggregate.
 *
 * Hysteresis:
 * - a model enters degraded at the high threshold;
 * - once degraded, it must cross the lower recovery threshold
 *   before becoming healthy again.
 *
 * Decay:
 * - effective evidence decays exponentially with age;
 * - stale/insufficient evidence becomes neutral, never blocked.
 */
export function evaluateRoutingStability(
  stats,
  {
    previousState =
      "neutral",

    nowMs =
      Date.now(),

    config =
      {},
  } = {},
) {
  const normalizedPrevious =
    normalizePreviousState(
      previousState,
    );

  const resolvedConfig =
    normalizeConfig(
      config,
    );

  const model =
    typeof stats?.model === "string"
      ? stats.model
      : null;

  const attempts =
    Number.isFinite(
      stats?.attempts,
    )
      ? Math.max(
          0,
          stats.attempts,
        )
      : 0;

  if (
    !stats
    || attempts <= 0
  ) {
    return neutralResult({
      model,
      previousState:
        normalizedPrevious,
      reason:
        "no_evidence",
    });
  }

  const observedMs =
    parseObservedAt(
      stats.lastObservedAt,
    );

  if (observedMs === null) {
    return neutralResult({
      model,
      previousState:
        normalizedPrevious,
      reason:
        "unknown_recency",
      attempts,
    });
  }

  const safeNow =
    finiteNumber(
      nowMs,
      Date.now(),
    );

  const ageMs =
    Math.max(
      0,
      safeNow - observedMs,
    );

  const decayFactor =
    Math.pow(
      0.5,
      ageMs
      / resolvedConfig.halfLifeMs,
    );

  const effectiveAttempts =
    attempts
    * decayFactor;

  const observedFailureRate =
    Number.isFinite(
      stats.failureRate,
    )
      ? Math.max(
          0,
          Math.min(
            1,
            stats.failureRate,
          ),
        )
      : rate(
          (
            stats.failures || 0
          )
          + (
            stats.exceptions || 0
          ),
          attempts,
        );

  const rateLimitedRate =
    rate(
      stats.rateLimitedFailures || 0,
      attempts,
    );

  const serverFailureRate =
    rate(
      stats.serverFailures || 0,
      attempts,
    );

  if (
    ageMs
    >= resolvedConfig.staleAfterMs
  ) {
    return neutralResult({
      model,
      previousState:
        normalizedPrevious,
      reason:
        "stale",
      attempts,
      effectiveAttempts,
      ageMs,
      decayFactor,
      failureRate:
        observedFailureRate,
      rateLimitedRate,
      serverFailureRate,
    });
  }

  if (
    effectiveAttempts
    < resolvedConfig.minAttempts
  ) {
    return neutralResult({
      model,
      previousState:
        normalizedPrevious,
      reason:
        "insufficient_effective_evidence",
      attempts,
      effectiveAttempts,
      ageMs,
      decayFactor,
      failureRate:
        observedFailureRate,
      rateLimitedRate,
      serverFailureRate,
    });
  }

  const enterFailure =
    observedFailureRate
    >= resolvedConfig.enterFailureRate;

  const enterRateLimit =
    rateLimitedRate
    >= resolvedConfig.enterRateLimitRate;

  const enterServerFailure =
    serverFailureRate
    >= resolvedConfig.enterServerFailureRate;

  const shouldEnterDegraded =
    enterFailure
    || enterRateLimit
    || enterServerFailure;

  const recovered =
    observedFailureRate
      <= resolvedConfig.recoverFailureRate
    && rateLimitedRate
      <= resolvedConfig.recoverRateLimitRate
    && serverFailureRate
      <= resolvedConfig.recoverServerFailureRate;

  let state;
  let transition;
  let reason;

  if (
    normalizedPrevious
    === "degraded"
  ) {
    if (recovered) {
      state =
        "healthy";

      transition =
        "recover";

      reason =
        "recovery_threshold_crossed";
    } else {
      state =
        "degraded";

      transition =
        "hold_degraded";

      reason =
        shouldEnterDegraded
          ? "degraded_threshold"
          : "hysteresis_hold";
    }
  } else if (
    shouldEnterDegraded
  ) {
    state =
      "degraded";

    transition =
      "enter_degraded";

    if (enterFailure) {
      reason =
        "failure_rate";
    } else if (enterRateLimit) {
      reason =
        "rate_limit_rate";
    } else {
      reason =
        "server_failure_rate";
    }
  } else {
    state =
      "healthy";

    transition =
      normalizedPrevious === "healthy"
        ? "hold_healthy"
        : "enter_healthy";

    reason =
      "within_healthy_threshold";
  }

  return Object.freeze({
    v: 1,

    model,

    state,

    previousState:
      normalizedPrevious,

    transition,

    reason,

    attempts,

    effectiveAttempts,

    ageMs,

    decayFactor,

    failureRate:
      observedFailureRate,

    rateLimitedRate,

    serverFailureRate,

    advisoryOnly:
      true,
  });
}


/**
 * Build an advisory stability snapshot from C.4.2 performance state.
 *
 * previousStates may be:
 * - Map(model -> state)
 * - plain object { model: state }
 *
 * This function does not mutate previousStates.
 */
export function buildRoutingStabilitySnapshot(
  performanceSnapshot,
  {
    previousStates =
      null,

    nowMs =
      Date.now(),

    config =
      {},
  } = {},
) {
  const source =
    performanceSnapshot?.statsByModel;

  const statesByModel =
    new Map();

  if (!(source instanceof Map)) {
    return Object.freeze({
      v: 1,

      generatedAt:
        new Date(
          finiteNumber(
            nowMs,
            Date.now(),
          ),
        ).toISOString(),

      statesByModel,

      modelsEvaluated:
        0,

      advisoryOnly:
        true,
    });
  }

  for (
    const [
      model,
      stats,
    ]
    of source
  ) {
    let previousState =
      "neutral";

    if (
      previousStates
      instanceof Map
    ) {
      previousState =
        previousStates.get(model)
        || "neutral";
    } else if (
      previousStates
      && typeof previousStates === "object"
    ) {
      previousState =
        previousStates[model]
        || "neutral";
    }

    statesByModel.set(
      model,
      evaluateRoutingStability(
        stats,
        {
          previousState,
          nowMs,
          config,
        },
      ),
    );
  }

  return Object.freeze({
    v: 1,

    generatedAt:
      new Date(
        finiteNumber(
          nowMs,
          Date.now(),
        ),
      ).toISOString(),

    statesByModel,

    modelsEvaluated:
      statesByModel.size,

    advisoryOnly:
      true,
  });
}


export function getRoutingStability(
  snapshot,
  {
    model,
  } = {},
) {
  if (
    !model
    || !(snapshot?.statesByModel instanceof Map)
  ) {
    return null;
  }

  return (
    snapshot.statesByModel.get(
      model,
    )
    || null
  );
}


export function extractRoutingStabilityStates(
  snapshot,
) {
  const states =
    new Map();

  if (
    !(snapshot?.statesByModel instanceof Map)
  ) {
    return states;
  }

  for (
    const [
      model,
      result,
    ]
    of snapshot.statesByModel
  ) {
    states.set(
      model,
      result?.state
      || "neutral",
    );
  }

  return states;
}
