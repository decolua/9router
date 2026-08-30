import {
  subscribeRoutingOutcomes,
} from "./routingOutcome.js";

import {
  buildRoutingPerformanceSnapshot,
  recordRoutingPerformanceOutcome,
  resetRoutingPerformanceState,
} from "./routingPerformance.js";

import {
  buildRoutingStabilitySnapshot,
  extractRoutingStabilityStates,
} from "./routingStability.js";

import {
  buildRoutingLearningScorePreview,
} from "./routingLearningScore.js";


export const ROUTING_FEEDBACK_RUNTIME_CONTRACT =
  Object.freeze({
    version: 1,

    authority:
      "soft-ranking-only",

    persistence:
      "none",

    failOpen:
      true,

    hardBlock:
      false,

    strategies:
      Object.freeze([
        "fallback",
      ]),
  });


let unsubscribe =
  null;

const previousStatesByScope =
  new Map();


function normalizeModels(
  models,
) {
  return Array.isArray(models)
    ? [...models]
    : [];
}


function scopeKey(
  comboName,
) {
  if (
    typeof comboName === "string"
    && comboName.trim()
  ) {
    return comboName.trim();
  }

  return "__global__";
}


function neutralScore(
  model,
  reason =
    "feedback_unavailable",
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

    reason,

    hardBlock:
      false,

    advisoryOnly:
      true,
  });
}


function neutralPreview(
  {
    models = [],
    comboName = null,
    nowMs = Date.now(),
    reason = "feedback_unavailable",
  } = {},
) {
  const scoresByModel =
    new Map();

  for (
    const model
    of normalizeModels(models)
  ) {
    scoresByModel.set(
      model,
      neutralScore(
        model,
        reason,
      ),
    );
  }

  return Object.freeze({
    v: 1,

    comboName,

    generatedAt:
      new Date(nowMs)
        .toISOString(),

    performanceSnapshot:
      null,

    stabilitySnapshot:
      null,

    learningPreview:
      null,

    scoresByModel,

    modelsEvaluated:
      scoresByModel.size,

    feedbackAvailable:
      false,

    advisoryOnly:
      true,

    hardBlock:
      false,
  });
}


export function ensureRoutingFeedbackRuntimeStarted() {
  if (
    typeof unsubscribe
    === "function"
  ) {
    return true;
  }

  try {
    unsubscribe =
      subscribeRoutingOutcomes(
        (event) => {
          try {
            recordRoutingPerformanceOutcome(
              event,
            );
          } catch {
            // Feedback collection is strictly fail-open.
          }
        },
      );

    return true;
  } catch {
    unsubscribe =
      null;

    return false;
  }
}


export function stopRoutingFeedbackRuntime() {
  if (
    typeof unsubscribe
    === "function"
  ) {
    try {
      unsubscribe();
    } catch {
      // Fail open.
    }
  }

  unsubscribe =
    null;
}


export function resetRoutingFeedbackRuntimeState() {
  try {
    resetRoutingPerformanceState();
  } catch {
    // Fail open.
  }

  previousStatesByScope.clear();
}


export function buildRoutingFeedbackRuntimePreview({
  models = [],
  comboName = null,
  nowMs = Date.now(),
} = {}) {
  const configured =
    normalizeModels(
      models,
    );

  ensureRoutingFeedbackRuntimeStarted();

  try {
    const performanceSnapshot =
      buildRoutingPerformanceSnapshot({
        routeKind:
          "chat",

        comboName,

        models:
          configured,

        nowMs,
      });

    const key =
      scopeKey(
        comboName,
      );

    const previousStates =
      previousStatesByScope.get(
        key,
      )
      || new Map();

    const stabilitySnapshot =
      buildRoutingStabilitySnapshot(
        performanceSnapshot,
        {
          previousStates,
          nowMs,
        },
      );

    previousStatesByScope.set(
      key,
      extractRoutingStabilityStates(
        stabilitySnapshot,
      ),
    );

    const learningPreview =
      buildRoutingLearningScorePreview(
        stabilitySnapshot,
        {
          models:
            configured,
        },
      );

    return Object.freeze({
      v: 1,

      comboName,

      generatedAt:
        learningPreview.generatedAt,

      performanceSnapshot,

      stabilitySnapshot,

      learningPreview,

      scoresByModel:
        learningPreview
          .scoresByModel,

      modelsEvaluated:
        learningPreview
          .modelsEvaluated,

      feedbackAvailable:
        true,

      advisoryOnly:
        true,

      hardBlock:
        false,
    });
  } catch {
    return neutralPreview({
      models:
        configured,

      comboName,

      nowMs,

      reason:
        "feedback_pipeline_error",
    });
  }
}
