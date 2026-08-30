import {
  getCombos,
  getSettings,
} from "../db/index.js";

import {
  buildEffectiveModelSet,
} from "./effective.js";

import {
  buildRoutingTelemetryBatch,
  getRoutingTelemetry,
} from "./routingTelemetry.js";

import {
  normalizeAuthoritySignal,
  normalizeHealthSignal,
  normalizePricingSignal,
  normalizeQuotaSignal,
} from "./routingSignals.js";

import {
  rankRoutingCandidates,
  scoreRoutingCandidate,
  ROUTING_SCORE_PROFILE,
} from "./routingScore.js";

function neutralLatencySignal() {
  return {
    known: false,
    authority: false,

    totalSamples: 0,
    ttftSamples: 0,

    totalMedianMs: null,
    totalP95Ms: null,

    ttftMedianMs: null,
    ttftP95Ms: null,
  };
}

function neutralReliabilitySignal() {
  return {
    known: false,
    authority: false,

    successSamples: 0,
    failureSamples: 0,
    successRate: null,
  };
}

function neutralHistoryFreshness() {
  return {
    newestObservedAt: null,
    newestAgeMs: null,
    classified: false,
  };
}

function buildPreviewSignals(
  entry,
  scoringContext,
) {
  const model =
    entry?.model || {};

  const nowMs =
    scoringContext?.nowMs
    || Date.now();

  const telemetry =
    getRoutingTelemetry(
      scoringContext?.historyIndex,
      {
        providers: [
          entry?.providerId,
          entry?.alias,
        ].filter(Boolean),

        model:
          model.id,
      },
    );

  const health =
    normalizeHealthSignal(
      model.health,
      {
        nowMs,
      },
    );

  return {
    v: 1,

    identity: {
      provider:
        entry?.providerId
        || entry?.alias
        || null,

      model:
        model.id || null,

      connectionId:
        null,
    },

    authority:
      normalizeAuthoritySignal(
        model,
      ),

    health,

    quota:
      normalizeQuotaSignal(
        null,
        {
          nowMs,
          exact: false,
          source: null,
        },
      ),

    latency:
      telemetry?.latency
      || neutralLatencySignal(),

    reliability:
      telemetry?.reliability
      || neutralReliabilitySignal(),

    cost:
      normalizePricingSignal(
        null,
      ),

    freshness: {
      history:
        telemetry?.freshness
        || neutralHistoryFreshness(),

      health: {
        observedAt:
          health.testedAt,

        ageMs:
          health.ageMs,
      },
    },

    routing: {
      changed: false,
      score: null,
      rank: null,
    },
  };
}

function directScoringPreview(
  entry,
  scoringContext,
) {
  if (!scoringContext) {
    return null;
  }

  const signals =
    buildPreviewSignals(
      entry,
      scoringContext,
    );

  const result =
    scoreRoutingCandidate(
      signals,
    );

  return {
    ...result,

    rank: null,

    telemetrySamples:
      (
        signals.reliability
          .successSamples
        || 0
      )
      + (
        signals.reliability
          .failureSamples
        || 0
      ),

    routingChanged:
      false,

    selectorIntegrated:
      false,
  };
}


function addReference(
  map,
  reference,
  value,
) {
  const key =
    String(reference || "").trim();

  if (!key) return;

  if (!map.has(key)) {
    map.set(key, value);
  }
}

function buildModelIndex(effective) {
  const index = new Map();

  for (
    const provider
    of Object.values(
      effective.providers || {},
    )
  ) {
    for (
      const model
      of Object.values(
        provider.models || {},
      )
    ) {
      const value = {
        providerId:
          provider.providerId,

        alias:
          provider.alias,

        model,
      };

      addReference(
        index,
        model.fullModel,
        value,
      );

      addReference(
        index,
        `${provider.alias}/${model.id}`,
        value,
      );

      addReference(
        index,
        `${provider.providerId}/${model.id}`,
        value,
      );
    }
  }

  return index;
}

function directProjection(
  entry,
  scoringContext = null,
) {
  const model = entry.model;

  const state =
    model.operatorPolicy?.state
    || "default";

  const baseCandidateSignal =
    (
      model.routingSnapshot
        ?.activeConnections || 0
    ) > 0
    && (
      model.routingSnapshot
        ?.unlockedConnections || 0
    ) > 0;

  const dryRunExcluded =
    state === "quarantine"
    || state === "disable";

  const reasons = [];

  if (dryRunExcluded) {
    reasons.push(
      `policy:${state}`,
    );
  }

  if (state === "deprioritize") {
    reasons.push(
      "deprioritize_not_applicable_to_explicit_direct_target",
    );
  }

  if (state === "allow") {
    reasons.push(
      "allow_does_not_override_runtime_availability",
    );
  }

  const scoringPreview =
    directScoringPreview(
      entry,
      scoringContext,
    );

  return {
    providerId:
      entry.providerId,

    alias:
      entry.alias,

    modelId:
      model.id,

    fullModel:
      model.fullModel,

    operatorPolicy:
      model.operatorPolicy,

    current: {
      policyAuthority: true,

      policyExcluded:
        dryRunExcluded,

      baseCandidateSignal,

      routingSnapshot:
        model.routingSnapshot,

      note:
        "Current direct routing enforces operator DISABLE/QUARANTINE; DEPRIORITIZE is not applicable to an explicit direct target.",
    },

    dryRun: {
      policyAuthoritySimulated: false,

      policyAuthorityMirrorsRuntime:
        true,

      excluded:
        dryRunExcluded,

      deprioritized:
        false,

      allowOverridesRuntime:
        false,

      reasons,
    },

    scoringPreview,
  };
}

function resolveComboMember(
  index,
  member,
) {
  return index.get(member) || null;
}

function currentComboState(
  resolved,
) {
  if (!resolved) {
    return {
      included: true,
      excludedReasons: [],
      deprioritized: false,
      unresolved: true,
    };
  }

  const model =
    resolved.model;

  const excludedReasons = [];

  const state =
    model.operatorPolicy?.state
    || "default";

  if (model.operatorDisabled) {
    excludedReasons.push(
      "disabledModels",
    );
  }

  if (
    model.comboContext
      ?.quarantined
  ) {
    excludedReasons.push(
      "selector_quarantine",
    );
  }

  if (
    state === "quarantine"
    || state === "disable"
  ) {
    const reason = `policy:${state}`;

    if (!excludedReasons.includes(reason)) {
      excludedReasons.push(reason);
    }
  }

  return {
    included:
      excludedReasons.length === 0,

    excludedReasons,

    deprioritized:
      state === "deprioritize",

    unresolved: false,
  };
}

function dryRunComboState(
  resolved,
  current,
) {
  if (!current.included) {
    return {
      included: false,
      relativeAction: "excluded",
      reasons:
        [...current.excludedReasons],
    };
  }

  if (!resolved) {
    return {
      included: true,
      relativeAction: "keep",
      reasons: [
        "policy_unknown_for_unresolved_member",
      ],
    };
  }

  const state =
    resolved.model.operatorPolicy
      ?.state
    || "default";

  if (
    state === "quarantine"
    || state === "disable"
  ) {
    return {
      included: false,
      relativeAction: "excluded",
      reasons: [
        `policy:${state}`,
      ],
    };
  }

  if (state === "deprioritize") {
    return {
      included: true,
      relativeAction: "tail",
      reasons: [
        "policy:deprioritize",
      ],
    };
  }

  if (state === "allow") {
    return {
      included: true,
      relativeAction: "keep",
      reasons: [
        "policy:allow",
      ],
    };
  }

  return {
    included: true,
    relativeAction: "keep",
    reasons: [],
  };
}

function comboStrategyFor(
  settings,
  comboName,
) {
  const override =
    settings.comboStrategies
      ?.[comboName]
      ?.fallbackStrategy;

  return (
    override
    || settings.comboStrategy
    || "fallback"
  );
}

function buildComboProjection(
  combo,
  settings,
  modelIndex,
  scoringContext = null,
) {
  const strategy =
    comboStrategyFor(
      settings,
      combo.name,
    );

  const members =
    Array.isArray(combo.models)
      ? combo.models
      : [];

  const projected =
    members.map(
      (rawMember, originalIndex) => {
        const member =
          String(rawMember || "");

        const resolved =
          resolveComboMember(
            modelIndex,
            member,
          );

        const current =
          currentComboState(
            resolved,
          );

        const dryRun =
          dryRunComboState(
            resolved,
            current,
          );

        return {
          member,
          originalIndex,
          resolved:
            !!resolved,

          providerId:
            resolved?.providerId
            || null,

          modelId:
            resolved?.model.id
            || null,

          operatorPolicy:
            resolved?.model
              .operatorPolicy
            || null,

          current,
          dryRun,
        };
      },
    );

  const scoreResult =
    scoringContext
      ? rankRoutingCandidates(
          projected
            .filter(
              (item) =>
                item.resolved,
            )
            .map(
              (item) => ({
                occurrence:
                  item.originalIndex,

                member:
                  item.member,

                signals:
                  buildPreviewSignals(
                    {
                      providerId:
                        item.providerId,

                      alias:
                        item.resolved
                          ? (
                              resolveComboMember(
                                modelIndex,
                                item.member,
                              )?.alias
                              || item.providerId
                            )
                          : item.providerId,

                      model:
                        resolveComboMember(
                          modelIndex,
                          item.member,
                        )?.model
                        || null,
                    },

                    scoringContext,
                  ),
              }),
            ),
        )
      : {
          ranked: [],
          blocked: [],
          routingChanged: false,
          selectorIntegrated: false,
        };

  const scoreByOccurrence =
    new Map();

  for (
    const item
    of [
      ...scoreResult.ranked,
      ...scoreResult.blocked,
    ]
  ) {
    scoreByOccurrence.set(
      item.occurrence,
      item.routingScore,
    );
  }

  const projectedWithScore =
    projected.map(
      (item) => ({
        ...item,

        scoringPreview:
          item.resolved
            ? (
                scoreByOccurrence.get(
                  item.originalIndex,
                )
                || null
              )
            : {
                eligibleForRanking:
                  false,

                tier:
                  "unresolved",

                score:
                  null,

                confidence:
                  0,

                components:
                  {},

                reasons: [
                  "unresolved_member",
                ],

                rank:
                  null,
              },
      }),
    );


  const currentRetained =
    projected.filter(
      (item) =>
        item.current.included,
    );

  const currentNormal =
    currentRetained.filter(
      (item) =>
        !item.current.deprioritized,
    );

  const currentTail =
    currentRetained.filter(
      (item) =>
        item.current.deprioritized,
    );

  const currentCandidates = [
    ...currentNormal,
    ...currentTail,
  ].map(
    (item) => item.member,
  );

  const retained =
    projected.filter(
      (item) =>
        item.dryRun.included,
    );

  const normal =
    retained.filter(
      (item) =>
        item.dryRun
          .relativeAction
        !== "tail",
    );

  const tail =
    retained.filter(
      (item) =>
        item.dryRun
          .relativeAction
        === "tail",
    );

  const dryRunCandidates = [
    ...normal,
    ...tail,
  ].map(
    (item) => item.member,
  );

  const orderMode =
    strategy === "round-robin"
      ? "rotation-dependent"
      : strategy === "fusion"
        ? "fusion-panel"
        : "ordered-fallback";

  return {
    id:
      combo.id,

    name:
      combo.name,

    kind:
      combo.kind || null,

    strategy,

    orderMode,

    stickyLimit:
      settings
        .comboStickyRoundRobinLimit
      || 1,

    currentCandidates,

    dryRunCandidates,

    summary: {
      configuredMembers:
        projected.length,

      currentCandidates:
        currentCandidates.length,

      dryRunCandidates:
        dryRunCandidates.length,

      currentExcluded:
        projected.filter(
          (item) =>
            !item.current.included,
        ).length,

      currentDeprioritized:
        projected.filter(
          (item) =>
            item.current.deprioritized,
        ).length,

      dryRunExcluded:
        projected.filter(
          (item) =>
            !item.dryRun.included,
        ).length,

      dryRunDeprioritized:
        projected.filter(
          (item) =>
            item.dryRun
              .relativeAction
            === "tail",
        ).length,

      scoringRanked:
        scoreResult.ranked.length,

      scoringBlocked:
        scoreResult.blocked.length,

      unresolved:
        projected.filter(
          (item) =>
            !item.resolved,
        ).length,
    },

    scoringPreview: {
      mode:
        "deterministic-score-preview",

      rankedCandidates:
        scoreResult.ranked.map(
          (item) =>
            item.member,
        ),

      blockedCandidates:
        scoreResult.blocked.map(
          (item) =>
            item.member,
        ),

      routingChanged:
        false,

      selectorIntegrated:
        false,
    },

    members:
      projectedWithScore,
  };
}

export async function buildPolicyDryRun() {
  const nowMs =
    Date.now();

  const [
    effective,
    combos,
    settings,
    routingTelemetry,
  ] = await Promise.all([
    buildEffectiveModelSet(),
    getCombos(),
    getSettings(),

    buildRoutingTelemetryBatch({
      limit: 200,
      nowMs,
    }),
  ]);

  const scoringContext = {
    nowMs,

    historyIndex:
      routingTelemetry.historyIndex,
  };

  const modelIndex =
    buildModelIndex(effective);

  const direct = [];

  for (
    const provider
    of Object.values(
      effective.providers || {},
    )
  ) {
    for (
      const model
      of Object.values(
        provider.models || {},
      )
    ) {
      direct.push(
        directProjection(
          {
            providerId:
              provider.providerId,

            alias:
              provider.alias,

            model,
          },

          scoringContext,
        ),
      );
    }
  }

  const combo =
    (Array.isArray(combos)
      ? combos
      : []
    ).map(
      (item) =>
        buildComboProjection(
          item,
          settings || {},
          modelIndex,
          scoringContext,
        ),
    );

  const directWouldExclude =
    direct.filter(
      (item) =>
        item.dryRun.excluded,
    ).length;

  const directDeprioritizeNA =
    direct.filter(
      (item) =>
        item.operatorPolicy
          ?.state
        === "deprioritize",
    ).length;

  const comboMemberOccurrences =
    combo.reduce(
      (sum, item) =>
        sum
        + item.summary
          .configuredMembers,
      0,
    );

  const comboCurrentExcluded =
    combo.reduce(
      (sum, item) =>
        sum
        + item.summary
          .currentExcluded,
      0,
    );

  const comboDryRunExcluded =
    combo.reduce(
      (sum, item) =>
        sum
        + item.summary
          .dryRunExcluded,
      0,
    );

  const comboDryRunDeprioritized =
    combo.reduce(
      (sum, item) =>
        sum
        + item.summary
          .dryRunDeprioritized,
      0,
    );

  return {
    v: 1,

    generatedAt:
      new Date().toISOString(),

    mode:
      "policy-dry-run",

    authority: {
      routingChanged: false,

      dryRunIsRoutingAuthority:
        false,

      selectorIntegrated:
        true,

      operatorPolicyIsRoutingAuthority:
        true,

      comboRotationStateRead:
        false,

      comboRotationStateMutated:
        false,

      scoringPreviewIsRoutingAuthority:
        false,
    },

    scoringPreview: {
      mode:
        "deterministic-score-preview",

      profile:
        ROUTING_SCORE_PROFILE,

      telemetry: {
        rowsRead:
          routingTelemetry.rowsRead,

        limit:
          routingTelemetry.limit,
      },

      routingChanged:
        false,

      selectorIntegrated:
        false,

      rankIsAdvisory:
        true,
    },

    source: {
      effectiveGeneratedAt:
        effective.generatedAt,

      syncedAt:
        effective.source?.syncedAt
        || null,

      testedAt:
        effective.source?.testedAt
        || null,
    },

    summary: {
      models:
        direct.length,

      combos:
        combo.length,

      directWouldExclude,

      directDeprioritizeNA,

      comboMemberOccurrences,

      comboCurrentExcluded,

      comboDryRunExcluded,

      comboDryRunDeprioritized,
    },

    semantics: {
      default:
        "No additional policy effect.",

      allow:
        "Keep candidate eligible when otherwise feasible. Does not override model locks, provider errors, quota exhaustion, or other runtime constraints.",

      deprioritize:
        "Runtime combo routing moves DEPRIORITIZE candidates to the tail while preserving membership. It remains not applicable to an explicit direct target.",

      quarantine:
        "Runtime routing excludes QUARANTINE targets. This endpoint reports that authority without mutating selector state.",

      disable:
        "DISABLE is runtime routing authority for both direct and combo targets; legacy disabledModels remains authoritative as well.",
    },

    limitations: [
      "This endpoint does not change routing.",
      "This endpoint does not call getRotatedModels and therefore does not mutate combo rotation state.",
      "Exact next rank is intentionally not predicted for round-robin combos.",
      "Capability adapters can add or reorder runtime candidates after the configured combo stage.",
      "Antigravity live quota cache is not included in this dry-run.",
      "Direct baseCandidateSignal is observational and is not claimed to reproduce every runtime selector condition.",
      "Unresolved combo members are retained and marked unresolved rather than being guessed.",
      "C.2.2 scoring rank is advisory preview only and does not replace current combo order or round-robin rotation.",
      "Telemetry is read once as a bounded recent batch and grouped in memory; it is not routing authority.",
      "Pricing and live quota are not yet injected into the C.2.2 scoring preview and therefore remain neutral.",
    ],

    direct,

    combos:
      combo,
  };
}


export const __test__ = {
  directProjection,
  currentComboState,
  dryRunComboState,
  buildComboProjection,
  buildPreviewSignals,
  directScoringPreview,
};
