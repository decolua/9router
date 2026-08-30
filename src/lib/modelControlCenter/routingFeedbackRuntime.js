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

import {
  loadPersistedRoutingFeedbackEvents,
  loadPersistedRoutingFeedbackStates,
  persistRoutingFeedbackOutcome,
  persistRoutingFeedbackStates,
} from "../db/repos/routingFeedbackRepo.js";


export const ROUTING_FEEDBACK_RUNTIME_CONTRACT =
  Object.freeze({
    version: 2,

    authority:
      "soft-ranking-only",

    persistence:
      "sqlite-best-effort",

    hydration:
      "lazy-combo-scoped",

    writes:
      "best-effort-non-blocking",

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

const hydratedScopes =
  new Set();

const hydrationPromisesByScope =
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


async function hydrateRoutingFeedbackScope({
  comboName = null,
  nowMs = Date.now(),
} = {}) {
  const key =
    scopeKey(
      comboName,
    );

  /*
   * Persistence is deliberately combo-scoped.
   * Unscoped/direct routing never becomes global
   * learned state.
   */
  if (
    key === "__global__"
  ) {
    return false;
  }

  if (
    hydratedScopes.has(
      key,
    )
  ) {
    return true;
  }

  const existing =
    hydrationPromisesByScope.get(
      key,
    );

  if (
    existing
    && typeof existing.then
      === "function"
  ) {
    try {
      return await existing;
    } catch {
      return false;
    }
  }

  const hydration =
    (async () => {
      try {
        const [
          persistedEvents,
          persistedStates,
        ] =
          await Promise.all([
            loadPersistedRoutingFeedbackEvents({
              comboName:
                key,

              routeKind:
                "chat",

              strategy:
                "fallback",

              nowMs,
            }),

            loadPersistedRoutingFeedbackStates({
              comboName:
                key,

              nowMs,
            }),
          ]);

        /*
         * Repository evidence is canonical and bounded.
         * Replay directly into process-local performance
         * memory so it is not published a second time.
         */
        if (
          Array.isArray(
            persistedEvents,
          )
        ) {
          for (
            const event
            of persistedEvents
          ) {
            try {
              recordRoutingPerformanceOutcome(
                event,
              );
            } catch {
              // Invalid individual evidence is neutral.
            }
          }
        }

        if (
          persistedStates
          instanceof Map
          && persistedStates.size > 0
        ) {
          previousStatesByScope.set(
            key,
            new Map(
              persistedStates,
            ),
          );
        }

        hydratedScopes.add(
          key,
        );

        return true;
      } catch {
        /*
         * Persistence cannot make routing unavailable.
         * Leave hydration retryable.
         */
        return false;
      } finally {
        hydrationPromisesByScope.delete(
          key,
        );
      }
    })();

  hydrationPromisesByScope.set(
    key,
    hydration,
  );

  try {
    return await hydration;
  } catch {
    return false;
  }
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

          /*
           * Persist canonical outcome asynchronously.
           * This Promise is never awaited by routing.
           */
          try {
            const write =
              persistRoutingFeedbackOutcome(
                event,
              );

            if (
              write
              && typeof write.catch
                === "function"
            ) {
              void write.catch(
                () => {},
              );
            }
          } catch {
            // Persistence failure is strictly fail-open.
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
  hydratedScopes.clear();
  hydrationPromisesByScope.clear();
}


export async function buildHydratedRoutingFeedbackRuntimePreview({
  models = [],
  comboName = null,
  nowMs = Date.now(),
} = {}) {
  /*
   * C.5 runtime path:
   * hydrate persisted combo-scoped evidence first,
   * then delegate to the unchanged synchronous
   * C.4 feedback preview semantics.
   */
  try {
    await hydrateRoutingFeedbackScope({
      comboName,
      nowMs,
    });
  } catch {
    // Hydration is strictly fail-open.
  }

  return buildRoutingFeedbackRuntimePreview({
    models,
    comboName,
    nowMs,
  });
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

    const nextStates =
      extractRoutingStabilityStates(
        stabilitySnapshot,
      );

    previousStatesByScope.set(
      key,
      nextStates,
    );

    /*
     * Persist combo-scoped hysteresis state.
     * The Promise stays detached from routing.
     */
    if (
      key !== "__global__"
    ) {
      try {
        const write =
          persistRoutingFeedbackStates({
            comboName:
              key,

            statesByModel:
              nextStates,

            nowMs,
          });

        if (
          write
          && typeof write.catch
            === "function"
        ) {
          void write.catch(
            () => {},
          );
        }
      } catch {
        // State persistence is strictly fail-open.
      }
    }

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
