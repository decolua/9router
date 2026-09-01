function copyArray(value) {
  return Array.isArray(value)
    ? [...value]
    : [];
}

function cleanModel(value) {
  return (
    typeof value === "string" &&
    value.trim()
  )
    ? value.trim()
    : null;
}

function healthSummary(
  members = [],
) {
  const summary = {
    healthy: 0,
    unknown: 0,
    unhealthy: 0,
  };

  for (
    const member
    of members
  ) {
    const status =
      String(
        member?.health?.status ||
        "unknown",
      ).toLowerCase();

    if (
      status === "healthy"
    ) {
      summary.healthy += 1;
    } else if (
      status === "unhealthy"
    ) {
      summary.unhealthy += 1;
    } else {
      summary.unknown += 1;
    }
  }

  return summary;
}

function learningScores(
  adaptiveRuntime,
) {
  const rows =
    Array.isArray(
      adaptiveRuntime
        ?.rankedCandidates,
    )
      ? adaptiveRuntime
        .rankedCandidates
      : [];

  return rows
    .map(
      (row) => ({
        model:
          cleanModel(
            row?.model,
          ),

        learningAdjustment:
          Number.isFinite(
            Number(
              row
                ?.learningAdjustment,
            ),
          )
            ? Number(
                row
                  .learningAdjustment,
              )
            : 0,

        effectiveRoutingScore:
          Number.isFinite(
            Number(
              row
                ?.effectiveRoutingScore,
            ),
          )
            ? Number(
                row
                  .effectiveRoutingScore,
              )
            : null,
      }),
    )
    .filter(
      (row) =>
        row.model,
    );
}

export function createAutoRoutingDecision({
  classification,
  autoComboId,
  members = [],
  baseOrder = [],
  orderedModels = [],
  adaptiveRuntime = null,
  fallbackReason = null,
} = {}) {
  const scores =
    learningScores(
      adaptiveRuntime,
    );

  return {
    v: 1,

    routingMode:
      "automatic",

    routingToken:
      classification
        ?.routingToken ||
      null,

    requestedClass:
      classification
        ?.requestedClass ||
      null,

    resolvedClass:
      classification
        ?.resolvedClass ||
      null,

    classificationReason:
      classification
        ?.classificationReason ||
      null,

    autoComboId:
      autoComboId ||
      null,

    candidateCount:
      orderedModels.length,

    candidateIds:
      members
        .map(
          (member) =>
            member?.canonicalId,
        )
        .filter(Boolean),

    healthSummary:
      healthSummary(
        members,
      ),

    baseOrder:
      copyArray(
        baseOrder,
      ),

    learningApplied:
      Boolean(
        adaptiveRuntime
          ?.applied,
      ),

    learningScores:
      scores,

    hysteresisApplied:
      Boolean(
        adaptiveRuntime
          ?.applied,
      ),

    hysteresisPreviousWinner:
      null,

    hysteresisWinner:
      null,

    hysteresisReason:
      adaptiveRuntime?.applied
        ? "c5_stability_hysteresis_via_adaptive_runtime"
        : (
            adaptiveRuntime
              ?.reason ||
            "c5_adaptive_not_applied"
          ),

    attemptedModels: [],

    selectedModel:
      null,

    fallbackReason,

    finalResult:
      orderedModels.length > 0
        ? "pending"
        : "unavailable",
  };
}

export function recordAutoRoutingOutcome(
  decision,
  event = {},
) {
  if (
    !decision ||
    typeof decision !== "object"
  ) {
    return decision;
  }

  const candidateModel =
    cleanModel(
      event.candidateModel,
    );

  if (candidateModel) {
    decision
      .attemptedModels
      .push({
        model:
          candidateModel,

        attemptIndex:
          Number(
            event.attemptIndex,
          ) || null,

        attemptCount:
          Number(
            event.attemptCount,
          ) || null,

        outcome:
          event.outcome ||
          null,

        status:
          Number.isInteger(
            Number(
              event.status,
            ),
          )
            ? Number(
                event.status,
              )
            : null,

        fallbackEligible:
          Boolean(
            event
              .fallbackEligible,
          ),

        durationMs:
          Number.isFinite(
            Number(
              event.durationMs,
            ),
          )
            ? Number(
                event.durationMs,
              )
            : null,
      });
  }

  if (
    event.outcome ===
    "success"
  ) {
    decision.selectedModel =
      candidateModel;

    decision.finalResult =
      "success";

    decision.fallbackReason =
      decision
        .attemptedModels
        .length > 1
        ? "fallback_candidate_succeeded"
        : null;

  } else if (
    event.fallbackEligible
  ) {
    decision.finalResult =
      "pending";

    decision.fallbackReason =
      "candidate_failed_fallback";

  } else {
    decision.finalResult =
      event.outcome ===
      "exception"
        ? "exception"
        : "failure";

    decision.fallbackReason =
      "candidate_failed_terminal";
  }

  return decision;
}

export function finalizeAutoRoutingDecision(
  decision,
  response,
) {
  if (
    !decision ||
    typeof decision !== "object"
  ) {
    return decision;
  }

  if (
    decision.finalResult ===
    "pending"
  ) {
    decision.finalResult =
      response?.ok
        ? "success"
        : "failure";

    if (
      !response?.ok &&
      !decision
        .fallbackReason
    ) {
      decision.fallbackReason =
        "all_candidates_failed";
    }
  }

  return decision;
}

export function snapshotAutoRoutingDecision(
  decision,
) {
  if (
    !decision ||
    typeof decision !== "object"
  ) {
    return null;
  }

  return {
    ...decision,

    candidateIds:
      copyArray(
        decision
          .candidateIds,
      ),

    baseOrder:
      copyArray(
        decision
          .baseOrder,
      ),

    learningScores:
      copyArray(
        decision
          .learningScores,
      ).map(
        (row) => ({
          ...row,
        }),
      ),

    attemptedModels:
      copyArray(
        decision
          .attemptedModels,
      ).map(
        (row) => ({
          ...row,
        }),
      ),

    healthSummary: {
      ...(
        decision
          .healthSummary ||
        {}
      ),
    },
  };
}
