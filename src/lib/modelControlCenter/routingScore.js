const SCORE_BASELINE = 50;

const SCORE_WEIGHTS = Object.freeze({
  reliability: 30,
  latency: 20,
  health: 10,
  cost: 10,
  quota: 10,
});

function finite(value) {
  const parsed = Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : null;
}

function clamp(value, min, max) {
  return Math.min(
    max,
    Math.max(min, value),
  );
}

function policyState(signals) {
  return (
    signals?.authority
      ?.operatorPolicy?.state
    || "default"
  );
}

export function classifyRoutingCandidate(
  signals = {},
) {
  const authority =
    signals?.authority
    && typeof signals.authority
      === "object"
      ? signals.authority
      : {};

  const rawPolicy =
    String(
      authority?.operatorPolicy
        ?.state
      || "default",
    )
      .trim()
      .toLowerCase();

  const policy =
    [
      "default",
      "allow",
      "deprioritize",
      "quarantine",
      "disable",
    ].includes(rawPolicy)
      ? rawPolicy
      : "default";

  const reasons = [];

  // C.0 authority boundary:
  // operator DISABLE / QUARANTINE are
  // explicit routing authority.
  if (policy === "disable") {
    reasons.push(
      "operator_disabled",
    );
  }

  if (policy === "quarantine") {
    reasons.push(
      "operator_quarantine",
    );
  }

  // effectiveEligible is an observational
  // aggregate and may be false for reasons
  // that are NOT routing authority
  // (for example stale/no_active_connection).
  //
  // Therefore only explicitly-authoritative
  // reason codes may cross this boundary.
  const hardAuthorityReasons =
    new Set([
      "operator_disabled",
      "operator_quarantine",

      "disabled_model",

      "runtime_model_lock",
      "all_connections_model_locked",

      "exact_quota_exhausted",

      "selector_quarantine",

      "capability_incompatible",
    ]);

  const effectiveReasons =
    Array.isArray(
      authority?.reasons,
    )
      ? authority.reasons
      : [];

  for (
    const reason
    of effectiveReasons
  ) {
    if (
      hardAuthorityReasons.has(
        reason,
      )
    ) {
      reasons.push(reason);
    }
  }

  // Explicit runtime-authority channel.
  // C.3.2 may provide a hard authority
  // independently of effective preview.
  if (
    authority?.runtimeHardBlock
    === true
  ) {
    const runtimeReasons =
      Array.isArray(
        authority
          .runtimeHardReasons,
      )
        ? authority
          .runtimeHardReasons
        : [];

    if (
      runtimeReasons.length > 0
    ) {
      reasons.push(
        ...runtimeReasons,
      );
    } else {
      reasons.push(
        "runtime_authority_block",
      );
    }
  }

  // Capability is a hard request
  // constraint only when explicitly
  // classified as authoritative.
  const capability =
    signals?.capability;

  if (
    capability
      ?.authoritativeBlock
    === true
    || (
      capability
        ?.hardConstraint
      === true
      && capability
        ?.compatible
      === false
    )
  ) {
    reasons.push(
      "capability_incompatible",
    );
  }

  // Only exact/current quota exhaustion
  // may act as quota authority.
  if (
    signals?.quota
      ?.authoritativeBlock
    === true
  ) {
    reasons.push(
      "quota_authoritative_block",
    );
  }

  const blocked =
    reasons.length > 0;

  return {
    blocked,

    tier:
      blocked
        ? "blocked"
        : policy
          === "deprioritize"
          ? "deprioritized"
          : "normal",

    policy,

    reasons: [
      ...new Set(reasons),
    ],
  };
}

function scoreReliability(signals) {
  const reliability =
    signals?.reliability;

  if (
    reliability?.known !== true
  ) {
    return {
      known: false,
      value: 0,
      confidence: 0,
    };
  }

  const rate =
    finite(
      reliability.successRate,
    );

  if (rate === null) {
    return {
      known: false,
      value: 0,
      confidence: 0,
    };
  }

  const samples =
    Math.max(
      0,
      finite(
        (
          reliability.successSamples
          || 0
        )
        + (
          reliability.failureSamples
          || 0
        ),
      ) || 0,
    );

  // 0.5 success rate is neutral.
  // Signal is bounded to ±SCORE_WEIGHTS.reliability/2.
  const value =
    (clamp(rate, 0, 1) - 0.5)
    * SCORE_WEIGHTS.reliability;

  // Confidence is deliberately separate from score.
  // It saturates gradually and does not change ordering directly.
  const confidence =
    clamp(samples / 20, 0, 1);

  return {
    known: true,
    value,
    confidence,
  };
}

function scoreLatency(signals) {
  const latency =
    signals?.latency;

  if (latency?.known !== true) {
    return {
      known: false,
      value: 0,
      confidence: 0,
    };
  }

  const median =
    finite(
      latency.totalMedianMs
      ?? latency.ttftMedianMs,
    );

  if (
    median === null
    || median < 0
  ) {
    return {
      known: false,
      value: 0,
      confidence: 0,
    };
  }

  // Preview-v1 latency curve:
  // 500ms = strong positive
  // 2500ms = neutral
  // >=5000ms = strong negative
  //
  // This is bounded and deterministic.
  let normalized;

  if (median <= 2500) {
    normalized =
      1 - median / 2500;
  } else {
    normalized =
      -clamp(
        (median - 2500) / 2500,
        0,
        1,
      );
  }

  const samples =
    Math.max(
      latency.totalSamples || 0,
      latency.ttftSamples || 0,
    );

  return {
    known: true,

    value:
      normalized
      * SCORE_WEIGHTS.latency
      / 2,

    confidence:
      clamp(
        Number(samples) / 20,
        0,
        1,
      ),
  };
}

function scoreHealth(signals) {
  const health =
    signals?.health;

  if (health?.known !== true) {
    return {
      known: false,
      value: 0,
      confidence: 0,
    };
  }

  const category =
    String(
      health.category || "",
    ).toLowerCase();

  if (
    category === "pending"
    || category === "unknown"
  ) {
    return {
      known: false,
      value: 0,
      confidence: 0,
    };
  }

  const positive =
    category === "ok";

  return {
    known: true,

    value:
      positive
        ? SCORE_WEIGHTS.health / 2
        : -SCORE_WEIGHTS.health / 2,

    // Probe age is available from C.1,
    // but C.2.1 does not silently turn
    // old health into routing authority.
    confidence:
      health.ageMs === null
      || health.ageMs === undefined
        ? 0.5
        : clamp(
            1
            - Number(health.ageMs)
              / (30 * 60 * 1000),
            0,
            1,
          ),
  };
}

function scoreCost(signals) {
  const cost =
    signals?.cost;

  if (cost?.known !== true) {
    return {
      known: false,
      value: 0,
      confidence: 0,
    };
  }

  const input =
    finite(cost.inputPer1M);

  const output =
    finite(cost.outputPer1M);

  if (
    input === null
    && output === null
  ) {
    return {
      known: false,
      value: 0,
      confidence: 0,
    };
  }

  const blended =
    (
      (input || 0)
      + (output || 0)
    ) / (
      input !== null
      && output !== null
        ? 2
        : 1
    );

  // Preview-v1:
  // <= $1 / 1M blended = positive,
  // $10 = neutral,
  // >= $20 = negative.
  let normalized;

  if (blended <= 10) {
    normalized =
      1 - blended / 10;
  } else {
    normalized =
      -clamp(
        (blended - 10) / 10,
        0,
        1,
      );
  }

  return {
    known: true,

    value:
      normalized
      * SCORE_WEIGHTS.cost
      / 2,

    confidence: 1,
  };
}

function scoreQuota(signals) {
  const quota =
    signals?.quota;

  if (
    quota?.known !== true
    || quota.authoritativeBlock === true
  ) {
    return {
      known: false,
      value: 0,
      confidence: 0,
    };
  }

  const remaining =
    finite(
      quota.remainingPercentage,
    );

  if (remaining === null) {
    return {
      known: false,
      value: 0,
      confidence: 0,
    };
  }

  // >0 quota is a soft preference only.
  // 50% remaining is neutral.
  const normalized =
    clamp(
      remaining / 100,
      0,
      1,
    ) - 0.5;

  return {
    known: true,

    value:
      normalized
      * SCORE_WEIGHTS.quota,

    confidence:
      quota.exact === true
        ? 1
        : 0.5,
  };
}

export function scoreRoutingCandidate(
  signals = {},
) {
  const classification =
    classifyRoutingCandidate(
      signals,
    );

  if (classification.blocked) {
    return {
      eligibleForRanking: false,

      tier:
        classification.tier,

      score: null,

      confidence: 1,

      components: {},

      reasons:
        classification.reasons,
    };
  }

  const components = {
    reliability:
      scoreReliability(signals),

    latency:
      scoreLatency(signals),

    health:
      scoreHealth(signals),

    cost:
      scoreCost(signals),

    quota:
      scoreQuota(signals),
  };

  const values =
    Object.values(components);

  const scoreDelta =
    values.reduce(
      (sum, component) =>
        sum + component.value,
      0,
    );

  const known =
    values.filter(
      (component) =>
        component.known,
    );

  const confidence =
    known.length === 0
      ? 0
      : known.reduce(
          (sum, component) =>
            sum + component.confidence,
          0,
        ) / values.length;

  const score =
    clamp(
      SCORE_BASELINE
      + scoreDelta,
      0,
      100,
    );

  return {
    eligibleForRanking: true,

    tier:
      classification.tier,

    score:
      Number(score.toFixed(4)),

    confidence:
      Number(
        clamp(
          confidence,
          0,
          1,
        ).toFixed(4),
      ),

    components,

    reasons: [],
  };
}

export function rankRoutingCandidates(
  candidates = [],
) {
  const scored =
    (Array.isArray(candidates)
      ? candidates
      : []
    ).map(
      (candidate, originalIndex) => ({
        ...candidate,

        originalIndex,

        routingScore:
          scoreRoutingCandidate(
            candidate?.signals || {},
          ),
      }),
    );

  const eligible =
    scored.filter(
      (candidate) =>
        candidate.routingScore
          .eligibleForRanking,
    );

  const blocked =
    scored.filter(
      (candidate) =>
        !candidate.routingScore
          .eligibleForRanking,
    );

  const tierValue = {
    normal: 0,
    deprioritized: 1,
  };

  eligible.sort((a, b) => {
    const aTier =
      tierValue[
        a.routingScore.tier
      ] ?? 99;

    const bTier =
      tierValue[
        b.routingScore.tier
      ] ?? 99;

    if (aTier !== bTier) {
      return aTier - bTier;
    }

    if (
      a.routingScore.score
      !== b.routingScore.score
    ) {
      return (
        b.routingScore.score
        - a.routingScore.score
      );
    }

    // Deterministic stable tie-breaker:
    // preserve configured/original order.
    return (
      a.originalIndex
      - b.originalIndex
    );
  });

  return {
    ranked:
      eligible.map(
        (candidate, index) => ({
          ...candidate,

          routingScore: {
            ...candidate.routingScore,
            rank: index + 1,
          },
        }),
      ),

    blocked:
      blocked.map(
        (candidate) => ({
          ...candidate,

          routingScore: {
            ...candidate.routingScore,
            rank: null,
          },
        }),
      ),

    routingChanged: false,

    selectorIntegrated: false,
  };
}

export const ROUTING_SCORE_PROFILE = Object.freeze({
  version: 1,
  baseline: SCORE_BASELINE,
  weights: SCORE_WEIGHTS,

  semantics: {
    unknown:
      "neutral",

    confidence:
      "reported separately from score",

    deprioritize:
      "separate lower-priority tier",

    authority:
      "hard-blocked candidates are not ranked",

    tieBreaker:
      "preserve original candidate order",
  },
});
