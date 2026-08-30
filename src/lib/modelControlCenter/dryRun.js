import {
  getCombos,
  getSettings,
} from "../db/index.js";

import {
  buildEffectiveModelSet,
} from "./effective.js";

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

function directProjection(entry) {
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

      unresolved:
        projected.filter(
          (item) =>
            !item.resolved,
        ).length,
    },

    members:
      projected,
  };
}

export async function buildPolicyDryRun() {
  const [
    effective,
    combos,
    settings,
  ] = await Promise.all([
    buildEffectiveModelSet(),
    getCombos(),
    getSettings(),
  ]);

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
        directProjection({
          providerId:
            provider.providerId,

          alias:
            provider.alias,

          model,
        }),
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
};
