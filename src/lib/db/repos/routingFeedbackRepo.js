import crypto from "node:crypto";

import {
  getAdapter,
} from "../driver.js";

import {
  normalizeRoutingOutcome,
} from "../../modelControlCenter/routingOutcome.js";


const DEFAULT_MAX_EVENTS =
  256;

const DEFAULT_MAX_EVENTS_PER_MODEL =
  32;

const DEFAULT_STALE_AFTER_MS =
  60 * 60 * 1000;


export const ROUTING_FEEDBACK_PERSISTENCE_CONTRACT =
  Object.freeze({
    version: 1,

    storage:
      "sqlite",

    tables:
      Object.freeze([
        "routingFeedbackEvents",
        "routingFeedbackStates",
      ]),

    authority:
      "none",

    scope:
      "combo",

    routeKind:
      "chat",

    strategy:
      "fallback",

    persistedEvidence:
      "canonical-routing-outcomes",

    persistedLearningScore:
      false,

    persistedHysteresisState:
      true,

    failOpen:
      true,

    maxEvents:
      DEFAULT_MAX_EVENTS,

    maxEventsPerModel:
      DEFAULT_MAX_EVENTS_PER_MODEL,

    staleAfterMs:
      DEFAULT_STALE_AFTER_MS,

    crossComboLearning:
      false,
  });


function finiteNumber(
  value,
  fallback,
) {
  const parsed =
    Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : fallback;
}


function positiveInteger(
  value,
  fallback,
) {
  const parsed =
    Number(value);

  if (
    !Number.isInteger(parsed)
    || parsed < 1
  ) {
    return fallback;
  }

  return parsed;
}


function cleanString(
  value,
) {
  if (
    typeof value !== "string"
  ) {
    return null;
  }

  const result =
    value.trim();

  return result || null;
}


function cleanModels(
  models,
) {
  if (!Array.isArray(models)) {
    return [];
  }

  return [
    ...new Set(
      models
        .map(cleanString)
        .filter(Boolean),
    ),
  ];
}


function validTimestamp(
  value,
  {
    nowMs =
      Date.now(),

    allowFutureMs =
      60 * 1000,
  } = {},
) {
  if (
    typeof value !== "string"
  ) {
    return null;
  }

  const parsed =
    Date.parse(value);

  if (!Number.isFinite(parsed)) {
    return null;
  }

  const safeNow =
    finiteNumber(
      nowMs,
      Date.now(),
    );

  if (
    parsed
    > safeNow + allowFutureMs
  ) {
    return null;
  }

  return new Date(parsed)
    .toISOString();
}


function canonicalizeEvent(
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

  const comboName =
    cleanString(
      normalized.comboName,
    );

  const candidateModel =
    cleanString(
      normalized.candidateModel,
    );

  if (
    normalized.routeKind
      !== "chat"
    || normalized.strategy
      !== "fallback"
    || !comboName
    || !candidateModel
  ) {
    return null;
  }

  /*
   * normalizeRoutingOutcome intentionally timestamps
   * observation time at normalization. For persisted
   * recovery we preserve an already validated canonical
   * observedAt when one is supplied.
   */
  const suppliedObservedAt =
    validTimestamp(
      rawEvent?.observedAt,
      {
        nowMs,
      },
    );

  const observedAt =
    suppliedObservedAt
    || normalized.observedAt;

  return Object.freeze({
    v: 1,

    observedAt,

    routeKind:
      "chat",

    comboName,

    strategy:
      "fallback",

    candidateModel,

    attemptIndex:
      normalized.attemptIndex,

    attemptCount:
      normalized.attemptCount,

    outcome:
      normalized.outcome,

    status:
      normalized.status,

    isWinner:
      Boolean(
        normalized.isWinner,
      ),

    fallbackEligible:
      Boolean(
        normalized.fallbackEligible,
      ),

    durationMs:
      Number.isFinite(
        normalized.durationMs,
      )
        ? normalized.durationMs
        : null,
  });
}


function rowToCanonicalEvent(
  row,
  {
    nowMs =
      Date.now(),
  } = {},
) {
  if (!row) {
    return null;
  }

  const observedAt =
    validTimestamp(
      row.observedAt,
      {
        nowMs,
      },
    );

  if (!observedAt) {
    return null;
  }

  return canonicalizeEvent(
    {
      v: 1,
      observedAt,

      routeKind:
        row.routeKind,

      comboName:
        row.comboName,

      strategy:
        row.strategy,

      candidateModel:
        row.candidateModel,

      attemptIndex:
        row.attemptIndex,

      attemptCount:
        row.attemptCount,

      outcome:
        row.outcome,

      status:
        row.status,

      fallbackEligible:
        row.fallbackEligible === 1,

      durationMs:
        row.durationMs,
    },
    {
      nowMs,
    },
  );
}


function staleCutoffIso(
  nowMs,
  staleAfterMs,
) {
  const safeNow =
    finiteNumber(
      nowMs,
      Date.now(),
    );

  const horizon =
    Math.max(
      1,
      finiteNumber(
        staleAfterMs,
        DEFAULT_STALE_AFTER_MS,
      ),
    );

  return new Date(
    safeNow - horizon,
  ).toISOString();
}


function pruneEventsInTransaction(
  db,
  {
    candidateModel,

    routeKind =
      "chat",

    nowMs =
      Date.now(),

    staleAfterMs =
      DEFAULT_STALE_AFTER_MS,

    maxEvents =
      DEFAULT_MAX_EVENTS,

    maxEventsPerModel =
      DEFAULT_MAX_EVENTS_PER_MODEL,
  } = {},
) {
  db.run(
    `DELETE FROM routingFeedbackEvents
      WHERE observedAt < ?`,
    [
      staleCutoffIso(
        nowMs,
        staleAfterMs,
      ),
    ],
  );

  if (candidateModel) {
    db.run(
      `DELETE FROM routingFeedbackEvents
        WHERE id IN (
          SELECT id
            FROM routingFeedbackEvents
           WHERE routeKind = ?
             AND candidateModel = ?
           ORDER BY observedAt DESC, rowid DESC
           LIMIT -1 OFFSET ?
        )`,
      [
        routeKind,
        candidateModel,
        positiveInteger(
          maxEventsPerModel,
          DEFAULT_MAX_EVENTS_PER_MODEL,
        ),
      ],
    );
  }

  db.run(
    `DELETE FROM routingFeedbackEvents
      WHERE id IN (
        SELECT id
          FROM routingFeedbackEvents
         ORDER BY observedAt DESC, rowid DESC
         LIMIT -1 OFFSET ?
      )`,
    [
      positiveInteger(
        maxEvents,
        DEFAULT_MAX_EVENTS,
      ),
    ],
  );
}


export async function persistRoutingFeedbackOutcome(
  rawEvent,
  {
    nowMs =
      Date.now(),
  } = {},
) {
  try {
    const event =
      canonicalizeEvent(
        rawEvent,
        {
          nowMs,
        },
      );

    if (!event) {
      return null;
    }

    const db =
      await getAdapter();

    const id =
      crypto.randomUUID();

    db.transaction(() => {
      db.run(
        `INSERT INTO routingFeedbackEvents(
           id,
           observedAt,
           routeKind,
           comboName,
           strategy,
           candidateModel,
           attemptIndex,
           attemptCount,
           outcome,
           status,
           isWinner,
           fallbackEligible,
           durationMs
         )
         VALUES(
           ?, ?, ?, ?, ?, ?, ?,
           ?, ?, ?, ?, ?, ?
         )`,
        [
          id,
          event.observedAt,
          event.routeKind,
          event.comboName,
          event.strategy,
          event.candidateModel,
          event.attemptIndex,
          event.attemptCount,
          event.outcome,
          event.status,
          event.isWinner
            ? 1
            : 0,
          event.fallbackEligible
            ? 1
            : 0,
          event.durationMs,
        ],
      );

      pruneEventsInTransaction(
        db,
        {
          candidateModel:
            event.candidateModel,

          routeKind:
            event.routeKind,

          nowMs,
        },
      );
    });

    return Object.freeze({
      id,
      event,
    });
  } catch {
    return null;
  }
}


export async function loadPersistedRoutingFeedbackEvents({
  comboName,

  models =
    null,

  routeKind =
    "chat",

  strategy =
    "fallback",

  nowMs =
    Date.now(),

  staleAfterMs =
    DEFAULT_STALE_AFTER_MS,

  limit =
    DEFAULT_MAX_EVENTS,
} = {}) {
  try {
    const scope =
      cleanString(
        comboName,
      );

    if (!scope) {
      return [];
    }

    if (
      routeKind !== "chat"
      || strategy !== "fallback"
    ) {
      return [];
    }

    const db =
      await getAdapter();

    const modelList =
      cleanModels(
        models,
      );

    const params = [
      routeKind,
      scope,
      strategy,
      staleCutoffIso(
        nowMs,
        staleAfterMs,
      ),
    ];

    let modelSql = "";

    if (modelList.length > 0) {
      modelSql =
        ` AND candidateModel IN (${
          modelList
            .map(() => "?")
            .join(", ")
        })`;

      params.push(
        ...modelList,
      );
    }

    params.push(
      Math.min(
        DEFAULT_MAX_EVENTS,
        positiveInteger(
          limit,
          DEFAULT_MAX_EVENTS,
        ),
      ),
    );

    const rows =
      db.all(
        `SELECT
           observedAt,
           routeKind,
           comboName,
           strategy,
           candidateModel,
           attemptIndex,
           attemptCount,
           outcome,
           status,
           isWinner,
           fallbackEligible,
           durationMs
         FROM routingFeedbackEvents
         WHERE routeKind = ?
           AND comboName = ?
           AND strategy = ?
           AND observedAt >= ?
           ${modelSql}
         ORDER BY observedAt DESC, rowid DESC
         LIMIT ?`,
        params,
      );

    const result = [];

    for (
      const row
      of rows.reverse()
    ) {
      const event =
        rowToCanonicalEvent(
          row,
          {
            nowMs,
          },
        );

      if (event) {
        result.push(event);
      }
    }

    return result;
  } catch {
    return [];
  }
}


function normalizeState(
  value,
) {
  if (
    value === "healthy"
    || value === "degraded"
  ) {
    return value;
  }

  return "neutral";
}


export async function persistRoutingFeedbackStates({
  comboName,

  statesByModel,

  nowMs =
    Date.now(),
} = {}) {
  try {
    const scope =
      cleanString(
        comboName,
      );

    if (
      !scope
      || !(
        statesByModel
        instanceof Map
      )
    ) {
      return false;
    }

    const updatedAt =
      new Date(
        finiteNumber(
          nowMs,
          Date.now(),
        ),
      ).toISOString();

    const db =
      await getAdapter();

    db.transaction(() => {
      for (
        const [
          rawModel,
          rawState,
        ]
        of statesByModel
      ) {
        const model =
          cleanString(
            rawModel,
          );

        if (!model) {
          continue;
        }

        const state =
          normalizeState(
            rawState,
          );

        if (
          state === "neutral"
        ) {
          db.run(
            `DELETE FROM routingFeedbackStates
              WHERE comboName = ?
                AND candidateModel = ?`,
            [
              scope,
              model,
            ],
          );

          continue;
        }

        db.run(
          `INSERT INTO routingFeedbackStates(
             comboName,
             candidateModel,
             state,
             updatedAt
           )
           VALUES(?, ?, ?, ?)
           ON CONFLICT(
             comboName,
             candidateModel
           )
           DO UPDATE SET
             state = excluded.state,
             updatedAt = excluded.updatedAt`,
          [
            scope,
            model,
            state,
            updatedAt,
          ],
        );
      }

      db.run(
        `DELETE FROM routingFeedbackStates
          WHERE updatedAt < ?`,
        [
          staleCutoffIso(
            nowMs,
            DEFAULT_STALE_AFTER_MS,
          ),
        ],
      );
    });

    return true;
  } catch {
    return false;
  }
}


export async function loadPersistedRoutingFeedbackStates({
  comboName,

  models =
    null,

  nowMs =
    Date.now(),

  staleAfterMs =
    DEFAULT_STALE_AFTER_MS,
} = {}) {
  const result =
    new Map();

  try {
    const scope =
      cleanString(
        comboName,
      );

    if (!scope) {
      return result;
    }

    const db =
      await getAdapter();

    const modelList =
      cleanModels(
        models,
      );

    const params = [
      scope,
      staleCutoffIso(
        nowMs,
        staleAfterMs,
      ),
    ];

    let modelSql = "";

    if (modelList.length > 0) {
      modelSql =
        ` AND candidateModel IN (${
          modelList
            .map(() => "?")
            .join(", ")
        })`;

      params.push(
        ...modelList,
      );
    }

    const rows =
      db.all(
        `SELECT
           candidateModel,
           state,
           updatedAt
         FROM routingFeedbackStates
         WHERE comboName = ?
           AND updatedAt >= ?
           ${modelSql}`,
        params,
      );

    for (
      const row
      of rows
    ) {
      const model =
        cleanString(
          row.candidateModel,
        );

      const state =
        normalizeState(
          row.state,
        );

      if (
        !model
        || state === "neutral"
        || !validTimestamp(
          row.updatedAt,
          {
            nowMs,
          },
        )
      ) {
        continue;
      }

      result.set(
        model,
        state,
      );
    }

    return result;
  } catch {
    return result;
  }
}
