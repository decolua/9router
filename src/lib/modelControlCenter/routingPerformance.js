import {
  normalizeRoutingOutcome,
} from "./routingOutcome.js";


const DEFAULT_MAX_EVENTS =
  256;

const DEFAULT_MAX_EVENTS_PER_MODEL =
  32;


export const ROUTING_PERFORMANCE_CONTRACT =
  Object.freeze({
    version: 1,

    persistence:
      "none",

    authority:
      "observer-only",

    scoring:
      "none",

    decay:
      "none",

    defaultMaxEvents:
      DEFAULT_MAX_EVENTS,

    defaultMaxEventsPerModel:
      DEFAULT_MAX_EVENTS_PER_MODEL,
  });


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


function safeNowMs(
  value,
) {
  const number =
    Number(value);

  if (
    !Number.isFinite(number)
  ) {
    return Date.now();
  }

  return number;
}


function eventKey(
  event,
) {
  return (
    `${event.routeKind || "chat"}`
    + "\0"
    + `${event.candidateModel}`
  );
}


function cloneCanonicalEvent(
  event,
  nowMs,
) {
  return Object.freeze({
    v:
      event.v,

    observedAt:
      new Date(
        safeNowMs(nowMs),
      ).toISOString(),

    routeKind:
      event.routeKind,

    comboName:
      event.comboName,

    strategy:
      event.strategy,

    candidateModel:
      event.candidateModel,

    attemptIndex:
      event.attemptIndex,

    attemptCount:
      event.attemptCount,

    outcome:
      event.outcome,

    status:
      event.status,

    isWinner:
      event.isWinner,

    fallbackEligible:
      event.fallbackEligible,

    durationMs:
      event.durationMs,
  });
}


export function createRoutingPerformanceState({
  maxEvents =
    DEFAULT_MAX_EVENTS,

  maxEventsPerModel =
    DEFAULT_MAX_EVENTS_PER_MODEL,
} = {}) {
  const limits =
    Object.freeze({
      maxEvents:
        positiveInteger(
          maxEvents,
          DEFAULT_MAX_EVENTS,
        ),

      maxEventsPerModel:
        positiveInteger(
          maxEventsPerModel,
          DEFAULT_MAX_EVENTS_PER_MODEL,
        ),
    });

  let events = [];


  function trim() {
    /*
     * First enforce the per-model bound.
     *
     * Walk newest -> oldest so the most recent samples
     * always survive.
     */
    const counts =
      new Map();

    const keep =
      new Array(
        events.length,
      ).fill(true);

    for (
      let index =
        events.length - 1;

      index >= 0;

      index -= 1
    ) {
      const event =
        events[index];

      const key =
        eventKey(event);

      const count =
        (
          counts.get(key)
          || 0
        ) + 1;

      counts.set(
        key,
        count,
      );

      if (
        count
        > limits.maxEventsPerModel
      ) {
        keep[index] =
          false;
      }
    }

    events =
      events.filter(
        (_, index) =>
          keep[index],
      );

    /*
     * Then enforce the process-wide bound.
     */
    if (
      events.length
      > limits.maxEvents
    ) {
      events =
        events.slice(
          -limits.maxEvents,
        );
    }
  }


  function record(
    rawEvent,
    {
      nowMs =
        Date.now(),
    } = {},
  ) {
    let normalized;

    try {
      normalized =
        normalizeRoutingOutcome(
          rawEvent,
        );
    } catch {
      return null;
    }

    if (!normalized) {
      return null;
    }

    const stored =
      cloneCanonicalEvent(
        normalized,
        nowMs,
      );

    events.push(
      stored,
    );

    trim();

    return stored;
  }


  function snapshot({
    routeKind =
      "chat",

    comboName =
      null,

    models =
      null,

    nowMs =
      Date.now(),
  } = {}) {
    const modelFilter =
      Array.isArray(models)
      && models.length > 0
        ? new Set(models)
        : null;

    const statsByModel =
      new Map();

    let matchedEvents =
      0;

    for (
      const event
      of events
    ) {
      if (
        routeKind
        && event.routeKind
        !== routeKind
      ) {
        continue;
      }

      if (
        comboName
        && event.comboName
        !== comboName
      ) {
        continue;
      }

      if (
        modelFilter
        && !modelFilter.has(
          event.candidateModel,
        )
      ) {
        continue;
      }

      matchedEvents += 1;

      let stats =
        statsByModel.get(
          event.candidateModel,
        );

      if (!stats) {
        stats = {
          model:
            event.candidateModel,

          attempts: 0,

          successes: 0,

          failures: 0,

          exceptions: 0,

          fallbackFailures: 0,

          nonFallbackFailures: 0,

          rateLimitedFailures: 0,

          serverFailures: 0,

          durationSamples: 0,

          durationTotalMs: 0,

          lastObservedAt: null,

          recentOutcome: null,

          recentStatus: null,
        };

        statsByModel.set(
          event.candidateModel,
          stats,
        );
      }

      stats.attempts += 1;

      if (
        event.outcome
        === "success"
      ) {
        stats.successes += 1;
      } else if (
        event.outcome
        === "failure"
      ) {
        stats.failures += 1;

        if (
          event.fallbackEligible
        ) {
          stats.fallbackFailures += 1;
        } else {
          stats.nonFallbackFailures += 1;
        }
      } else if (
        event.outcome
        === "exception"
      ) {
        stats.exceptions += 1;

        if (
          event.fallbackEligible
        ) {
          stats.fallbackFailures += 1;
        } else {
          stats.nonFallbackFailures += 1;
        }
      }

      if (
        event.status === 429
      ) {
        stats.rateLimitedFailures += 1;
      }

      if (
        Number.isInteger(
          event.status,
        )
        && event.status >= 500
        && event.status <= 599
      ) {
        stats.serverFailures += 1;
      }

      if (
        Number.isFinite(
          event.durationMs,
        )
      ) {
        stats.durationSamples += 1;

        stats.durationTotalMs +=
          event.durationMs;
      }

      stats.lastObservedAt =
        event.observedAt;

      stats.recentOutcome =
        event.outcome;

      stats.recentStatus =
        event.status;
    }


    const finalized =
      new Map();

    for (
      const [
        model,
        stats,
      ]
      of statsByModel
    ) {
      const terminalFailures =
        stats.failures
        + stats.exceptions;

      finalized.set(
        model,
        Object.freeze({
          model,

          attempts:
            stats.attempts,

          successes:
            stats.successes,

          failures:
            stats.failures,

          exceptions:
            stats.exceptions,

          terminalFailures,

          fallbackFailures:
            stats.fallbackFailures,

          nonFallbackFailures:
            stats.nonFallbackFailures,

          rateLimitedFailures:
            stats.rateLimitedFailures,

          serverFailures:
            stats.serverFailures,

          successRate:
            stats.attempts > 0
              ? (
                  stats.successes
                  / stats.attempts
                )
              : null,

          failureRate:
            stats.attempts > 0
              ? (
                  terminalFailures
                  / stats.attempts
                )
              : null,

          averageDurationMs:
            stats.durationSamples > 0
              ? (
                  stats.durationTotalMs
                  / stats.durationSamples
                )
              : null,

          durationSamples:
            stats.durationSamples,

          lastObservedAt:
            stats.lastObservedAt,

          recentOutcome:
            stats.recentOutcome,

          recentStatus:
            stats.recentStatus,
        }),
      );
    }


    return Object.freeze({
      v: 1,

      generatedAt:
        new Date(
          safeNowMs(nowMs),
        ).toISOString(),

      retainedEvents:
        events.length,

      matchedEvents,

      limits,

      statsByModel:
        finalized,
    });
  }


  function reset() {
    events = [];
  }


  function size() {
    return events.length;
  }


  return Object.freeze({
    record,
    snapshot,
    reset,
    size,
    limits,
  });
}


const defaultState =
  createRoutingPerformanceState();


export function recordRoutingPerformanceOutcome(
  event,
  options,
) {
  return defaultState.record(
    event,
    options,
  );
}


export function buildRoutingPerformanceSnapshot(
  options,
) {
  return defaultState.snapshot(
    options,
  );
}


export function resetRoutingPerformanceState() {
  defaultState.reset();
}


export function getRoutingPerformance(
  snapshot,
  {
    model,
  } = {},
) {
  if (
    !model
    || !(snapshot?.statsByModel instanceof Map)
  ) {
    return null;
  }

  return (
    snapshot.statsByModel.get(
      model,
    )
    || null
  );
}
