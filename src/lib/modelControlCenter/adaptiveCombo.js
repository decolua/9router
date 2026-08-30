import {
  rankRoutingCandidates,
} from "./routingScore.js";

function normalizeModels(models) {
  return Array.isArray(models)
    ? [...models]
    : [];
}

function normalizeStrategy(strategy) {
  return String(
    strategy || "fallback",
  )
    .trim()
    .toLowerCase();
}

function lookupByModel(
  source,
  model,
) {
  if (!source) {
    return null;
  }

  if (source instanceof Map) {
    return (
      source.get(model)
      ?? null
    );
  }

  if (
    typeof source === "object"
  ) {
    return (
      source[model]
      ?? null
    );
  }

  return null;
}

function normalizeReasonList(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value
      .filter(Boolean)
      .map(String);
  }

  if (
    typeof value === "string"
  ) {
    return [value];
  }

  if (
    value === true
  ) {
    return [
      "runtime_authority_block",
    ];
  }

  if (
    typeof value === "object"
  ) {
    if (
      Array.isArray(value.reasons)
    ) {
      return value.reasons
        .filter(Boolean)
        .map(String);
    }

    if (value.reason) {
      return [
        String(value.reason),
      ];
    }

    if (value.blocked === true) {
      return [
        "runtime_authority_block",
      ];
    }
  }

  return [];
}

function runtimeScopedSignals(
  signals,
  hardReasons,
) {
  const base =
    signals
    && typeof signals === "object"
      ? signals
      : {};

  if (
    !Array.isArray(hardReasons)
    || hardReasons.length === 0
  ) {
    return base;
  }

  return {
    ...base,

    authority: {
      ...(
        base.authority
        && typeof base.authority
          === "object"
          ? base.authority
          : {}
      ),

      effectiveEligible:
        false,

      reasons: [
        ...new Set(
          hardReasons,
        ),
      ],
    },
  };
}

function sameOrder(
  left,
  right,
) {
  if (
    left.length
    !== right.length
  ) {
    return false;
  }

  for (
    let i = 0;
    i < left.length;
    i += 1
  ) {
    if (left[i] !== right[i]) {
      return false;
    }
  }

  return true;
}

function rankGroup({
  models,
  signalsByModel,
  hardBlocks,
}) {
  const candidates =
    models.map(
      (model, occurrence) => {
        const hardReasons =
          normalizeReasonList(
            lookupByModel(
              hardBlocks,
              model,
            ),
          );

        const signals =
          runtimeScopedSignals(
            lookupByModel(
              signalsByModel,
              model,
            ) || {},
            hardReasons,
          );

        return {
          model,
          occurrence,
          signals,
        };
      },
    );

  const result =
    rankRoutingCandidates(
      candidates,
    );

  return {
    ranked:
      result.ranked.map(
        (candidate) => ({
          model:
            candidate.model,

          occurrence:
            candidate.occurrence,

          routingScore:
            candidate.routingScore,
        }),
      ),

    blocked:
      result.blocked.map(
        (candidate) => ({
          model:
            candidate.model,

          occurrence:
            candidate.occurrence,

          routingScore:
            candidate.routingScore,
        }),
      ),
  };
}

/**
 * Build a deterministic adaptive ordering plan.
 *
 * IMPORTANT:
 * - Runtime application is intentionally NOT performed here.
 * - Only fallback strategy is adaptive.
 * - round-robin and fusion preserve their configured semantics.
 * - capabilityPriorityModels form a protected front tier.
 * - hard authority removes candidates before soft ordering.
 * - operator deprioritize remains a lower tier through routingScore.
 */
export function planAdaptiveComboOrder({
  models = [],
  strategy = "fallback",
  capabilityPriorityModels = [],
  signalsByModel = null,
  hardBlocks = null,
} = {}) {
  const configured =
    normalizeModels(models);

  const normalizedStrategy =
    normalizeStrategy(
      strategy,
    );

  if (
    normalizedStrategy
      !== "fallback"
  ) {
    return {
      v: 1,

      strategy:
        normalizedStrategy,

      adaptiveEligible:
        false,

      adaptiveReason:
        "strategy_preserved",

      configuredOrder:
        configured,

      orderedModels:
        [...configured],

      blockedModels: [],

      capabilityPriorityModels:
        [],

      wouldChangeOrder:
        false,

      runtimeApplied:
        false,

      selectorIntegrated:
        false,
    };
  }

  const capabilitySet =
    new Set(
      normalizeModels(
        capabilityPriorityModels,
      ),
    );

  const capabilityTier = [];
  const standardTier = [];

  for (const model of configured) {
    if (capabilitySet.has(model)) {
      capabilityTier.push(model);
    } else {
      standardTier.push(model);
    }
  }

  const capabilityResult =
    rankGroup({
      models:
        capabilityTier,

      signalsByModel,
      hardBlocks,
    });

  const standardResult =
    rankGroup({
      models:
        standardTier,

      signalsByModel,
      hardBlocks,
    });

  const ranked = [
    ...capabilityResult.ranked,
    ...standardResult.ranked,
  ];

  const blocked = [
    ...capabilityResult.blocked,
    ...standardResult.blocked,
  ];

  const orderedModels =
    ranked.map(
      (candidate) =>
        candidate.model,
    );

  const baselineWithoutBlocked =
    configured.filter(
      (model) =>
        !blocked.some(
          (candidate) =>
            candidate.model
              === model,
        ),
    );

  const rankedCandidates =
    ranked.map(
      (
        candidate,
        index,
      ) => ({
        ...candidate,

        adaptiveRank:
          index + 1,

        capabilityPriority:
          capabilitySet.has(
            candidate.model,
          ),
      }),
    );

  return {
    v: 1,

    strategy:
      normalizedStrategy,

    adaptiveEligible:
      true,

    adaptiveReason:
      "fallback_scoring",

    configuredOrder:
      configured,

    orderedModels,

    rankedCandidates,

    blockedModels:
      blocked.map(
        (candidate) => ({
          ...candidate,

          adaptiveRank:
            null,
        }),
      ),

    capabilityPriorityModels:
      capabilityResult.ranked.map(
        (candidate) =>
          candidate.model,
      ),

    wouldChangeOrder:
      !sameOrder(
        baselineWithoutBlocked,
        orderedModels,
      ),

    runtimeApplied:
      false,

    selectorIntegrated:
      false,
  };
}

export const ADAPTIVE_COMBO_CONTRACT =
  Object.freeze({
    version: 1,

    runtimeApplied: false,

    strategies: {
      fallback:
        "adaptive ordering eligible",

      roundRobin:
        "preserve existing rotation semantics",

      fusion:
        "preserve existing panel semantics",
    },

    authorityOrder: [
      "operator_disable_quarantine",
      "capability_constraint",
      "runtime_model_lock_exact_quota",
      "operator_deprioritize_tier",
      "adaptive_soft_score",
      "existing_fallback",
    ],

    semantics: {
      capabilityPriority:
        "protected front tier",

      unknownTelemetry:
        "neutral",

      hardAuthority:
        "blocked candidates are removed before soft ordering",

      tie:
        "configured order remains stable",
    },
  });
