import {
  planAdaptiveComboOrder,
} from "./adaptiveCombo.js";

import {
  buildRoutingTelemetryBatch,
  getRoutingTelemetry,
} from "./routingTelemetry.js";

import {
  createAdaptiveRuntimeInputs,
  loadRuntimeAuthoritySnapshot,
} from "./runtimeAuthority.js";

import {
  buildHydratedRoutingFeedbackRuntimePreview,
} from "./routingFeedbackRuntime.js";

function copyModels(models) {
  return Array.isArray(models)
    ? [...models]
    : [];
}

function parseMember(
  member,
  snapshot,
) {
  const runtime =
    snapshot?.byModel
      ?.get(member)
    || null;

  if (
    runtime?.model
    && (
      runtime.providerAlias
      || runtime.provider
    )
  ) {
    return {
      model:
        runtime.model,

      providers: [
        runtime.providerAlias,
        runtime.provider,
      ].filter(Boolean),
    };
  }

  if (
    typeof member !== "string"
    || !member.includes("/")
  ) {
    return null;
  }

  const slash =
    member.indexOf("/");

  const provider =
    member.slice(
      0,
      slash,
    );

  const model =
    member.slice(
      slash + 1,
    );

  if (
    !provider
    || !model
  ) {
    return null;
  }

  return {
    model,

    providers: [
      provider,
    ],
  };
}

function neutralAuthority(
  policyState = "default",
) {
  return {
    effectiveEligible:
      true,

    reasons: [],

    operatorPolicy: {
      state:
        policyState
        || "default",
    },
  };
}

function neutralHealth() {
  return {
    known: false,
    authority: false,
  };
}

function neutralLatency() {
  return {
    known: false,
    authority: false,
  };
}

function neutralReliability() {
  return {
    known: false,
    authority: false,

    successSamples: 0,
    failureSamples: 0,
    successRate: null,
  };
}

function neutralCost() {
  return {
    known: false,
    authority: false,
  };
}

function neutralQuota() {
  return {
    known: false,
    exact: false,

    authority: false,

    authoritativeBlock:
      false,
  };
}

export function buildAdaptiveSignalsByModel({
  models = [],
  telemetry,
  snapshot,
} = {}) {
  const result =
    new Map();

  for (
    const member
    of copyModels(models)
  ) {
    const identity =
      parseMember(
        member,
        snapshot,
      );

    const policyState =
      snapshot?.policyByModel
        ?.get(member)
      || "default";

    let historical =
      null;

    if (
      identity
      && telemetry?.historyIndex
    ) {
      historical =
        getRoutingTelemetry(
          telemetry.historyIndex,
          {
            providers:
              identity.providers,

            model:
              identity.model,
          },
        );
    }

    result.set(
      member,
      {
        v: 1,

        identity: {
          member,

          providers:
            identity?.providers
            || [],

          model:
            identity?.model
            || null,
        },

        authority:
          neutralAuthority(
            policyState,
          ),

        health:
          neutralHealth(),

        quota:
          neutralQuota(),

        latency:
          historical?.latency
          || neutralLatency(),

        reliability:
          historical?.reliability
          || neutralReliability(),

        cost:
          neutralCost(),

        routing: {
          runtimeAdaptive:
            true,

          selectorIntegrated:
            true,
        },
      },
    );
  }

  return result;
}

function unchanged({
  models,
  strategy,
  reason,
  error = null,
}) {
  return {
    v: 1,

    strategy,

    models:
      copyModels(models),

    applied:
      false,

    wouldChangeOrder:
      false,

    reason,

    blockedModels: [],

    telemetryRows:
      0,

    error:
      error
        ? String(
            error?.message
            || error,
          )
        : null,
  };
}

/**
 * Runtime adaptive ordering for chat combo FALLBACK only.
 *
 * Important:
 * - round-robin is returned untouched before any telemetry/authority reads.
 * - fusion is returned untouched before any telemetry/authority reads.
 * - failure of adaptive infrastructure fails open to existing ordering.
 * - if every candidate is hard-blocked, existing order is retained so the
 *   existing runtime remains responsible for final error semantics.
 */
export async function buildAdaptiveFallbackRuntimeOrder({
  models = [],
  strategy = "fallback",
  capabilityPriorityModels = [],
  comboName = null,

  nowMs = Date.now(),

  telemetryLoader =
    buildRoutingTelemetryBatch,

  authorityLoader =
    loadRuntimeAuthoritySnapshot,

  feedbackLoader =
    buildHydratedRoutingFeedbackRuntimePreview,
} = {}) {
  const configured =
    copyModels(models);

  const normalizedStrategy =
    String(
      strategy
      || "fallback",
    )
      .trim()
      .toLowerCase();

  if (
    normalizedStrategy
      !== "fallback"
  ) {
    return unchanged({
      models:
        configured,

      strategy:
        normalizedStrategy,

      reason:
        "strategy_preserved",
    });
  }

  if (
    configured.length
    <= 1
  ) {
    return unchanged({
      models:
        configured,

      strategy:
        normalizedStrategy,

      reason:
        "insufficient_candidates",
    });
  }

  try {
    const [
      telemetry,
      snapshot,
    ] = await Promise.all([
      telemetryLoader({
        limit: 200,
        nowMs,
      }),

      authorityLoader({
        models:
          configured,

        nowMs,
      }),
    ]);

    const baseSignals =
      buildAdaptiveSignalsByModel({
        models:
          configured,

        telemetry,

        snapshot,
      });

    const runtimeInputs =
      createAdaptiveRuntimeInputs({
        models:
          configured,

        signalsByModel:
          baseSignals,

        snapshot,
      });

    let feedbackRuntime =
      null;

    try {
      feedbackRuntime =
        await feedbackLoader({
          models:
            configured,

          comboName,

          nowMs,
        });
    } catch {
      // C.4 feedback must never disable C.3 adaptive routing.
      feedbackRuntime =
        null;
    }

    const learningScoresByModel =
      feedbackRuntime?.scoresByModel
      instanceof Map
        ? feedbackRuntime
          .scoresByModel
        : null;

    const plan =
      planAdaptiveComboOrder({
        models:
          configured,

        strategy:
          normalizedStrategy,

        capabilityPriorityModels:
          copyModels(
            capabilityPriorityModels,
          ),

        signalsByModel:
          runtimeInputs
            .signalsByModel,

        hardBlocks:
          runtimeInputs
            .hardBlocks,

        learningScoresByModel,
      });

    // Preserve existing error semantics when
    // the snapshot says every candidate is blocked.
    // Account selection remains final runtime authority.
    if (
      configured.length > 0
      && plan.orderedModels.length
        === 0
    ) {
      return {
        ...unchanged({
          models:
            configured,

          strategy:
            normalizedStrategy,

          reason:
            "all_candidates_blocked_fail_open",
        }),

        blockedModels:
          plan.blockedModels,

        telemetryRows:
          telemetry?.rowsRead
          || 0,
      };
    }

    return {
      v: 1,

      strategy:
        normalizedStrategy,

      models:
        plan.orderedModels,

      applied:
        true,

      wouldChangeOrder:
        plan.wouldChangeOrder,

      reason:
        "adaptive_fallback",

      rankedCandidates:
        plan.rankedCandidates,

      blockedModels:
        plan.blockedModels,

      telemetryRows:
        telemetry?.rowsRead
        || 0,

      error:
        null,
    };
  } catch (error) {
    // Adaptive ordering must never make
    // existing routing unavailable.
    return unchanged({
      models:
        configured,

      strategy:
        normalizedStrategy,

      reason:
        "adaptive_fail_open",

      error,
    });
  }
}

export const ADAPTIVE_RUNTIME_CONTRACT =
  Object.freeze({
    version: 1,

    selectorIntegrated:
      true,

    strategies: {
      fallback:
        "adaptive",

      roundRobin:
        "preserved",

      fusion:
        "preserved",
    },

    reads: {
      telemetry:
        "one bounded batch",

      authority:
        "one batched snapshot",
    },

    failureMode:
      "fail open to existing order",

    allBlocked:
      "retain existing order and existing error semantics",

    pricing:
      "neutral",

    health:
      "neutral",

    softQuota:
      "neutral",
  });
