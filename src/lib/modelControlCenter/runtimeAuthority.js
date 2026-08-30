import fs from "node:fs";

import {
  getProviderConnections,
} from "../db/repos/connectionsRepo.js";

import {
  getDisabledModels,
} from "../db/repos/disabledModelsRepo.js";

import {
  getModelPolicies,
} from "../db/repos/modelPoliciesRepo.js";

import {
  FREE_PROVIDERS,
  resolveProviderId,
} from "../../shared/constants/providers.js";

import {
  getAntigravityQuotaCache,
} from "../../sse/services/antigravityQuota.js";

import {
  getModelLockKey,
  MODEL_LOCK_ALL,
} from "../../../open-sse/services/accountFallback.js";

const SELECTOR_QUARANTINE_FILE =
  "/opt/openclaw-hermes-os/runtime/model-selector/quarantine.json";

const POLICY_STRENGTH =
  Object.freeze({
    default: 0,
    allow: 1,
    deprioritize: 2,
    quarantine: 3,
    disable: 4,
  });

function unique(
  values,
) {
  return [
    ...new Set(
      values.filter(Boolean),
    ),
  ];
}

function parseMember(
  member,
) {
  if (
    typeof member !== "string"
    || !member.includes("/")
  ) {
    return null;
  }

  const slash =
    member.indexOf("/");

  const rawAlias =
    member
      .slice(0, slash)
      .trim();

  const model =
    member
      .slice(slash + 1)
      .trim();

  if (
    !rawAlias
    || !model
  ) {
    return null;
  }

  let resolvedProvider =
    rawAlias;

  try {
    resolvedProvider =
      resolveProviderId(
        rawAlias,
      ) || rawAlias;
  } catch {
    resolvedProvider =
      rawAlias;
  }

  // model.js currently carries this local alias
  // in addition to the shared resolver.
  if (rawAlias === "xmtp") {
    resolvedProvider =
      "xiaomi-tokenplan";
  }

  return {
    member,
    rawAlias,
    provider:
      resolvedProvider,
    model,

    aliases:
      unique([
        rawAlias,
        resolvedProvider,
      ]),
  };
}

function strongestPolicy(
  states,
) {
  let winner =
    "default";

  let strength =
    POLICY_STRENGTH.default;

  for (const state of states) {
    const normalized =
      String(
        state || "default",
      )
        .trim()
        .toLowerCase();

    const candidate =
      POLICY_STRENGTH[
        normalized
      ];

    if (
      candidate !== undefined
      && candidate > strength
    ) {
      winner =
        normalized;

      strength =
        candidate;
    }
  }

  return winner;
}

function buildPolicyMap(
  policies,
) {
  const map =
    new Map();

  for (
    const policy
    of Array.isArray(policies)
      ? policies
      : []
  ) {
    if (
      !policy?.providerAlias
      || !policy?.modelId
    ) {
      continue;
    }

    map.set(
      `${policy.providerAlias}\0${policy.modelId}`,
      policy.state
      || "default",
    );
  }

  return map;
}

function policyForIdentity(
  identity,
  policyMap,
) {
  if (!identity) {
    return "default";
  }

  const states = [];

  for (
    const alias
    of identity.aliases
  ) {
    const state =
      policyMap.get(
        `${alias}\0${identity.model}`,
      );

    if (state) {
      states.push(state);
    }
  }

  return strongestPolicy(
    states,
  );
}

function disabledForIdentity(
  identity,
  disabled,
) {
  if (
    !identity
    || !disabled
    || typeof disabled !== "object"
  ) {
    return false;
  }

  for (
    const alias
    of identity.aliases
  ) {
    const ids =
      disabled?.[alias];

    if (!Array.isArray(ids)) {
      continue;
    }

    if (
      ids.includes(
        identity.model,
      )
      || ids.includes(
        identity.member,
      )
      || ids.includes(
        `${alias}/${identity.model}`,
      )
    ) {
      return true;
    }
  }

  return false;
}

function selectorQuarantined(
  identity,
  quarantine,
) {
  if (
    !identity
    || !(quarantine instanceof Set)
  ) {
    return false;
  }

  if (
    quarantine.has(
      identity.member,
    )
  ) {
    return true;
  }

  for (
    const alias
    of identity.aliases
  ) {
    if (
      quarantine.has(
        `${alias}/${identity.model}`,
      )
    ) {
      return true;
    }
  }

  return false;
}

export function readActiveSelectorQuarantine({
  nowMs = Date.now(),
  file =
    SELECTOR_QUARANTINE_FILE,
} = {}) {
  try {
    const raw =
      fs.readFileSync(
        file,
        "utf8",
      );

    const parsed =
      JSON.parse(raw);

    const active =
      new Set();

    for (
      const [
        model,
        until,
      ]
      of Object.entries(
        parsed || {},
      )
    ) {
      const expiresAt =
        Date.parse(until);

      if (
        Number.isFinite(
          expiresAt,
        )
        && expiresAt > nowMs
      ) {
        active.add(model);
      }
    }

    return active;
  } catch {
    return new Set();
  }
}

function groupConnections(
  connections,
) {
  const byProvider =
    new Map();

  for (
    const connection
    of Array.isArray(connections)
      ? connections
      : []
  ) {
    if (
      !connection?.provider
    ) {
      continue;
    }

    const current =
      byProvider.get(
        connection.provider,
      ) || [];

    current.push(connection);

    byProvider.set(
      connection.provider,
      current,
    );
  }

  return byProvider;
}

function connectionsForIdentity(
  identity,
  byProvider,
) {
  if (!identity) {
    return [];
  }

  const seen =
    new Set();

  const result = [];

  for (
    const provider
    of identity.aliases
  ) {
    const list =
      byProvider.get(
        provider,
      ) || [];

    for (const connection of list) {
      const key =
        connection?.id
        || connection;

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      result.push(connection);
    }
  }

  return result;
}

function isModelLockedAt(
  connection,
  model,
  nowMs,
) {
  if (!connection) {
    return false;
  }

  const key =
    getModelLockKey(
      model,
    );

  const expiry =
    connection[key]
    || connection[
      MODEL_LOCK_ALL
    ];

  if (!expiry) {
    return false;
  }

  const expiryMs =
    Date.parse(expiry);

  return (
    Number.isFinite(
      expiryMs,
    )
    && expiryMs > nowMs
  );
}

function exactQuotaBlockAt({
  provider,
  connectionId,
  model,
  quotaCache,
  nowMs,
}) {
  if (
    provider !== "antigravity"
    || !connectionId
    || !(quotaCache instanceof Map)
  ) {
    return {
      blocked: false,
      known: false,
      resetAt: null,
    };
  }

  const quota =
    quotaCache
      .get(connectionId)
      ?.[model];

  if (!quota) {
    return {
      blocked: false,
      known: false,
      resetAt: null,
    };
  }

  const remaining =
    Number(
      quota.remainingPercentage,
    );

  const resetMs =
    quota.resetAt
      ? Date.parse(
          quota.resetAt,
        )
      : Number.NaN;

  const activeReset =
    Number.isFinite(
      resetMs,
    )
    && resetMs > nowMs;

  const blocked =
    Number.isFinite(
      remaining,
    )
    && remaining <= 0
    && activeReset;

  return {
    blocked,
    known: true,

    remainingPercentage:
      Number.isFinite(
        remaining,
      )
        ? remaining
        : null,

    resetAt:
      activeReset
        ? quota.resetAt
        : null,
  };
}

function noAuthProvider(
  provider,
) {
  return Boolean(
    provider
    && FREE_PROVIDERS?.[provider]
      ?.noAuth,
  );
}

export function buildRuntimeAuthoritySnapshot({
  models = [],
  connections = [],
  disabled = {},
  policies = [],
  quotaCache = new Map(),
  selectorQuarantine = new Set(),
  nowMs = Date.now(),
} = {}) {
  const policyMap =
    buildPolicyMap(
      policies,
    );

  const byProvider =
    groupConnections(
      connections,
    );

  const byModel =
    new Map();

  const hardBlocksByModel =
    new Map();

  const policyByModel =
    new Map();

  for (
    const member
    of Array.isArray(models)
      ? models
      : []
  ) {
    const identity =
      parseMember(member);

    if (!identity) {
      byModel.set(
        member,
        {
          member,
          resolved: false,

          policyState:
            "default",

          hardBlocked:
            false,

          hardReasons: [],

          runtimeHardEvaluated:
            false,

          connectionCount: null,

          availableConnectionCount:
            null,
        },
      );

      continue;
    }

    const policyState =
      policyForIdentity(
        identity,
        policyMap,
      );

    policyByModel.set(
      member,
      policyState,
    );

    const hardReasons = [];

    if (
      policyState === "disable"
    ) {
      hardReasons.push(
        "operator_disabled",
      );
    }

    if (
      policyState === "quarantine"
    ) {
      hardReasons.push(
        "operator_quarantine",
      );
    }

    if (
      disabledForIdentity(
        identity,
        disabled,
      )
    ) {
      hardReasons.push(
        "disabled_model",
      );
    }

    if (
      selectorQuarantined(
        identity,
        selectorQuarantine,
      )
    ) {
      hardReasons.push(
        "selector_quarantine",
      );
    }

    const noAuth =
      noAuthProvider(
        identity.provider,
      );

    const providerConnections =
      connectionsForIdentity(
        identity,
        byProvider,
      );

    let runtimeHardEvaluated =
      false;

    let availableConnectionCount =
      null;

    let lockedConnectionCount =
      0;

    let exactQuotaBlockedCount =
      0;

    let exactQuotaKnownCount =
      0;

    if (noAuth) {
      runtimeHardEvaluated =
        true;

      // Public/no-auth providers have a virtual
      // connection in auth.js rather than a DB row.
      availableConnectionCount =
        1;
    } else if (
      providerConnections.length > 0
    ) {
      runtimeHardEvaluated =
        true;

      availableConnectionCount =
        0;

      for (
        const connection
        of providerConnections
      ) {
        const locked =
          isModelLockedAt(
            connection,
            identity.model,
            nowMs,
          );

        if (locked) {
          lockedConnectionCount += 1;
        }

        const quota =
          exactQuotaBlockAt({
            provider:
              identity.provider,

            connectionId:
              connection.id,

            model:
              identity.model,

            quotaCache,

            nowMs,
          });

        if (quota.known) {
          exactQuotaKnownCount += 1;
        }

        if (quota.blocked) {
          exactQuotaBlockedCount += 1;
        }

        if (
          !locked
          && !quota.blocked
        ) {
          availableConnectionCount +=
            1;
        }
      }

      if (
        availableConnectionCount === 0
      ) {
        if (
          lockedConnectionCount > 0
        ) {
          hardReasons.push(
            "runtime_model_lock",
          );
        }

        if (
          exactQuotaBlockedCount > 0
        ) {
          hardReasons.push(
            "exact_quota_exhausted",
          );
        }
      }
    }

    const uniqueReasons =
      unique(
        hardReasons,
      );

    const entry = {
      member,

      resolved:
        true,

      providerAlias:
        identity.rawAlias,

      provider:
        identity.provider,

      model:
        identity.model,

      policyState,

      hardBlocked:
        uniqueReasons.length > 0,

      hardReasons:
        uniqueReasons,

      noAuth,

      runtimeHardEvaluated,

      connectionCount:
        noAuth
          ? 0
          : providerConnections.length,

      availableConnectionCount,

      lockedConnectionCount,

      exactQuotaBlockedCount,

      exactQuotaKnownCount,
    };

    byModel.set(
      member,
      entry,
    );

    if (entry.hardBlocked) {
      hardBlocksByModel.set(
        member,
        [...entry.hardReasons],
      );
    }
  }

  return {
    v: 1,

    generatedAt:
      new Date(nowMs)
        .toISOString(),

    byModel,

    hardBlocksByModel,

    policyByModel,

    authority: {
      operatorPolicy:
        true,

      disabledModels:
        true,

      selectorQuarantine:
        true,

      runtimeModelLock:
        true,

      exactActiveQuota:
        true,

      noActiveConnection:
        false,

      unknown:
        "neutral",

      runtimeApplied:
        false,

      selectorIntegrated:
        false,
    },
  };
}

export function mergeRuntimeAuthorityIntoSignals(
  models,
  signalsByModel,
  snapshot,
) {
  const result =
    new Map();

  for (
    const member
    of Array.isArray(models)
      ? models
      : []
  ) {
    const base =
      signalsByModel instanceof Map
        ? (
            signalsByModel.get(
              member,
            ) || {}
          )
        : (
            signalsByModel?.[member]
            || {}
          );

    const runtime =
      snapshot?.byModel
        ?.get(member)
      || null;

    const policyState =
      runtime?.policyState
      || base?.authority
        ?.operatorPolicy
        ?.state
      || "default";

    const existingReasons =
      Array.isArray(
        base?.authority?.reasons,
      )
        ? base.authority.reasons
        : [];

    const hardReasons =
      runtime?.hardReasons
      || [];

    result.set(
      member,
      {
        ...base,

        authority: {
          ...(
            base.authority
            && typeof base.authority
              === "object"
              ? base.authority
              : {}
          ),

          operatorPolicy: {
            ...(
              base?.authority
                ?.operatorPolicy
              && typeof base.authority
                .operatorPolicy
                === "object"
                ? base.authority
                  .operatorPolicy
                : {}
            ),

            state:
              policyState,
          },

          effectiveEligible:
            hardReasons.length > 0
              ? false
              : (
                  base?.authority
                    ?.effectiveEligible
                  ?? true
                ),

          reasons:
            unique([
              ...existingReasons,
              ...hardReasons,
            ]),
        },
      },
    );
  }

  return result;
}

export function createAdaptiveRuntimeInputs({
  models = [],
  signalsByModel = null,
  snapshot,
} = {}) {
  return {
    signalsByModel:
      mergeRuntimeAuthorityIntoSignals(
        models,
        signalsByModel,
        snapshot,
      ),

    hardBlocks:
      snapshot?.hardBlocksByModel
      || new Map(),

    policyByModel:
      snapshot?.policyByModel
      || new Map(),
  };
}

export async function loadRuntimeAuthoritySnapshot({
  models = [],
  nowMs = Date.now(),
} = {}) {
  const [
    connections,
    disabled,
    policies,
  ] = await Promise.all([
    getProviderConnections({
      isActive: true,
    }),

    getDisabledModels(),

    getModelPolicies(),
  ]);

  const quotaCache =
    getAntigravityQuotaCache();

  const selectorQuarantine =
    readActiveSelectorQuarantine({
      nowMs,
    });

  return buildRuntimeAuthoritySnapshot({
    models,
    connections,
    disabled,
    policies,
    quotaCache,
    selectorQuarantine,
    nowMs,
  });
}

export const RUNTIME_AUTHORITY_CONTRACT =
  Object.freeze({
    version: 1,

    batchReads: {
      activeConnections:
        "one repository read",

      disabledModels:
        "one repository read",

      operatorPolicies:
        "one repository read",

      exactQuota:
        "read existing in-memory cache only",

      selectorQuarantine:
        "one local file read",
    },

    semantics: {
      operatorDisable:
        "hard block",

      operatorQuarantine:
        "hard block",

      disabledModel:
        "hard block",

      selectorQuarantine:
        "hard block in combo context",

      modelLock:
        "hard block only when no connection remains available",

      exactActiveQuota:
        "hard block only when no connection remains available",

      deprioritize:
        "policy tier, not exclusion",

      noActiveConnection:
        "neutral in C.3.2; existing runtime remains final authority",

      unknown:
        "neutral",
    },

    runtimeApplied:
      false,

    selectorIntegrated:
      false,
  });
