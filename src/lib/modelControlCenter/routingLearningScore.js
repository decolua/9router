const DEFAULT_MAX_BONUS =
  10;

const DEFAULT_MAX_PENALTY =
  20;

const DEFAULT_MIN_EFFECTIVE_ATTEMPTS =
  3;


export const ROUTING_LEARNING_SCORE_CONTRACT =
  Object.freeze({
    version: 1,

    authority:
      "advisory-only",

    routingIntegration:
      "none",

    persistence:
      "none",

    hardBlock:
      false,

    bounded:
      true,

    defaultMaxBonus:
      DEFAULT_MAX_BONUS,

    defaultMaxPenalty:
      DEFAULT_MAX_PENALTY,

    defaultMinEffectiveAttempts:
      DEFAULT_MIN_EFFECTIVE_ATTEMPTS,
  });


function finiteNumber(
  value,
  fallback = 0,
) {
  const number =
    Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}


function clamp(
  value,
  min,
  max,
) {
  return Math.max(
    min,
    Math.min(
      max,
      value,
    ),
  );
}


function safeRate(
  value,
) {
  return clamp(
    finiteNumber(
      value,
      0,
    ),
    0,
    1,
  );
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

  return number > 0
    ? number
    : fallback;
}


function normalizeConfig(
  config = {},
) {
  return Object.freeze({
    maxBonus:
      positiveNumber(
        config.maxBonus,
        DEFAULT_MAX_BONUS,
      ),

    maxPenalty:
      positiveNumber(
        config.maxPenalty,
        DEFAULT_MAX_PENALTY,
      ),

    minEffectiveAttempts:
      positiveNumber(
        config.minEffectiveAttempts,
        DEFAULT_MIN_EFFECTIVE_ATTEMPTS,
      ),
  });
}


/**
 * Learning score is deliberately weaker than C.3 authority/scoring.
 *
 * neutral -> 0
 * healthy -> bounded positive bonus
 * degraded -> bounded negative penalty
 *
 * It never creates a hard block.
 */
export function evaluateRoutingLearningScore(
  stability,
  {
    config =
      {},
  } = {},
) {
  const resolved =
    normalizeConfig(
      config,
    );

  const model =
    typeof stability?.model === "string"
      ? stability.model
      : null;

  const state =
    stability?.state;

  const effectiveAttempts =
    Math.max(
      0,
      finiteNumber(
        stability?.effectiveAttempts,
        0,
      ),
    );

  const confidence =
    clamp(
      effectiveAttempts
      / resolved.minEffectiveAttempts,
      0,
      1,
    );

  const failureRate =
    safeRate(
      stability?.failureRate,
    );

  const rateLimitedRate =
    safeRate(
      stability?.rateLimitedRate,
    );

  const serverFailureRate =
    safeRate(
      stability?.serverFailureRate,
    );

  if (
    state !== "healthy"
    && state !== "degraded"
  ) {
    return Object.freeze({
      v: 1,

      model,

      state:
        "neutral",

      scoreAdjustment:
        0,

      confidence:
        0,

      reason:
        "neutral_or_unknown",

      hardBlock:
        false,

      advisoryOnly:
        true,
    });
  }


  if (
    effectiveAttempts
    < resolved.minEffectiveAttempts
  ) {
    return Object.freeze({
      v: 1,

      model,

      state,

      scoreAdjustment:
        0,

      confidence,

      reason:
        "insufficient_effective_evidence",

      hardBlock:
        false,

      advisoryOnly:
        true,
    });
  }


  if (
    state === "healthy"
  ) {
    const reliability =
      clamp(
        1 - failureRate,
        0,
        1,
      );

    const bonus =
      resolved.maxBonus
      * reliability
      * confidence;

    return Object.freeze({
      v: 1,

      model,

      state,

      scoreAdjustment:
        Math.round(
          bonus * 1000,
        ) / 1000,

      confidence,

      reason:
        "healthy_reliability",

      hardBlock:
        false,

      advisoryOnly:
        true,
    });
  }


  /*
   * Degraded penalty uses the strongest observed failure dimension
   * plus a smaller contribution from the remaining dimensions.
   *
   * This prevents one metric from being counted three times while still
   * recognizing concentrated 429 / 5xx behavior.
   */
  const primaryFailure =
    Math.max(
      failureRate,
      rateLimitedRate,
      serverFailureRate,
    );

  const secondaryFailure =
    (
      failureRate
      + rateLimitedRate
      + serverFailureRate
      - primaryFailure
    ) / 2;

  const severity =
    clamp(
      (
        primaryFailure
        + (
          secondaryFailure
          * 0.25
        )
      ),
      0,
      1,
    );

  const penalty =
    resolved.maxPenalty
    * severity
    * confidence;

  return Object.freeze({
    v: 1,

    model,

    state,

    scoreAdjustment:
      -(
        Math.round(
          penalty * 1000,
        ) / 1000
      ),

    confidence,

    reason:
      "degraded_reliability",

    hardBlock:
      false,

    advisoryOnly:
      true,
  });
}


/**
 * Convert a C.4.3 stability snapshot into a bounded learning preview.
 */
export function buildRoutingLearningScorePreview(
  stabilitySnapshot,
  {
    models =
      null,

    config =
      {},
  } = {},
) {
  const source =
    stabilitySnapshot?.statesByModel;

  const filter =
    Array.isArray(models)
    && models.length > 0
      ? new Set(models)
      : null;

  const scoresByModel =
    new Map();

  if (
    source instanceof Map
  ) {
    for (
      const [
        model,
        stability,
      ]
      of source
    ) {
      if (
        filter
        && !filter.has(model)
      ) {
        continue;
      }

      scoresByModel.set(
        model,
        evaluateRoutingLearningScore(
          stability,
          {
            config,
          },
        ),
      );
    }
  }


  /*
   * Explicitly requested models with no evidence remain neutral.
   */
  if (filter) {
    for (
      const model
      of filter
    ) {
      if (
        scoresByModel.has(model)
      ) {
        continue;
      }

      scoresByModel.set(
        model,
        Object.freeze({
          v: 1,

          model,

          state:
            "neutral",

          scoreAdjustment:
            0,

          confidence:
            0,

          reason:
            "no_evidence",

          hardBlock:
            false,

          advisoryOnly:
            true,
        }),
      );
    }
  }


  return Object.freeze({
    v: 1,

    generatedAt:
      stabilitySnapshot?.generatedAt
      || new Date().toISOString(),

    modelsEvaluated:
      scoresByModel.size,

    scoresByModel,

    advisoryOnly:
      true,

    routingApplied:
      false,
  });
}


export function getRoutingLearningScore(
  preview,
  {
    model,
  } = {},
) {
  if (
    !model
    || !(preview?.scoresByModel instanceof Map)
  ) {
    return null;
  }

  return (
    preview.scoresByModel.get(
      model,
    )
    || null
  );
}
