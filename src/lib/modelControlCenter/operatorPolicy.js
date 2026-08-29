import {
  disableModels,
  enableModels,
  getDisabledModels,
} from "../db/repos/disabledModelsRepo.js";

import {
  getAdapter,
} from "../db/driver.js";

import {
  parseJson,
  stringifyJson,
} from "../db/helpers/jsonCol.js";

import {
  STORED_MODEL_POLICY_STATES,
  deleteModelPolicy,
  getModelPolicies,
  getModelPolicy,
  modelPolicyKey,
  setModelPolicy,
} from "../db/repos/modelPoliciesRepo.js";

export const OPERATOR_POLICY_STATES = [
  "default",
  "allow",
  "deprioritize",
  "quarantine",
  "disable",
];

const VALID_STATES =
  new Set(OPERATOR_POLICY_STATES);

function normalizeTarget(
  providerAlias,
  modelId,
) {
  const provider =
    String(providerAlias || "").trim();

  const model =
    String(modelId || "").trim();

  if (!provider || !model) {
    throw new Error(
      "providerAlias and modelId are required",
    );
  }

  return {
    providerAlias: provider,
    modelId: model,
  };
}

function disabledContains(
  disabled,
  providerAlias,
  modelId,
) {
  const ids =
    disabled?.[providerAlias];

  return (
    Array.isArray(ids)
    && ids.includes(modelId)
  );
}

export async function getOperatorPolicy(
  providerAlias,
  modelId,
) {
  const target =
    normalizeTarget(
      providerAlias,
      modelId,
    );

  const [
    disabled,
    stored,
  ] = await Promise.all([
    getDisabledModels(),
    getModelPolicy(
      target.providerAlias,
      target.modelId,
    ),
  ]);

  if (
    disabledContains(
      disabled,
      target.providerAlias,
      target.modelId,
    )
  ) {
    return {
      ...target,
      state: "disable",
      source: "disabledModels",
      explicit: true,
      updatedAt: null,
    };
  }

  if (stored) {
    return {
      ...stored,
      source: "modelPolicies",
      explicit: true,
    };
  }

  return {
    ...target,
    state: "default",
    source: "default",
    explicit: false,
    updatedAt: null,
  };
}

export async function listOperatorPolicies() {
  const [
    disabled,
    stored,
  ] = await Promise.all([
    getDisabledModels(),
    getModelPolicies(),
  ]);

  const map = new Map();

  for (const policy of stored) {
    const key =
      `${policy.providerAlias}\0${policy.modelId}`;

    map.set(key, {
      ...policy,
      source: "modelPolicies",
      explicit: true,
    });
  }

  // Existing disabledModels always wins.
  for (
    const [providerAlias, ids]
    of Object.entries(disabled || {})
  ) {
    if (!Array.isArray(ids)) continue;

    for (const rawId of ids) {
      const modelId =
        String(rawId || "").trim();

      if (!modelId) continue;

      const key =
        `${providerAlias}\0${modelId}`;

      map.set(key, {
        providerAlias,
        modelId,
        state: "disable",
        source: "disabledModels",
        explicit: true,
        updatedAt: null,
      });
    }
  }

  return [...map.values()].sort(
    (a, b) =>
      a.providerAlias.localeCompare(
        b.providerAlias,
      )
      || a.modelId.localeCompare(
        b.modelId,
      ),
  );
}

export async function setOperatorPolicy({
  providerAlias,
  modelId,
  state,
}) {
  const target =
    normalizeTarget(
      providerAlias,
      modelId,
    );

  const normalizedState =
    String(state || "")
      .trim()
      .toLowerCase();

  if (
    !VALID_STATES.has(
      normalizedState,
    )
  ) {
    throw new Error(
      `Invalid operator policy state: ${normalizedState}`,
    );
  }

  if (normalizedState === "disable") {
    await disableModels(
      target.providerAlias,
      [target.modelId],
    );

    await deleteModelPolicy(
      target.providerAlias,
      target.modelId,
    );

    return getOperatorPolicy(
      target.providerAlias,
      target.modelId,
    );
  }

  if (normalizedState === "default") {
    await deleteModelPolicy(
      target.providerAlias,
      target.modelId,
    );

    await enableModels(
      target.providerAlias,
      [target.modelId],
    );

    return getOperatorPolicy(
      target.providerAlias,
      target.modelId,
    );
  }

  // Write the new intent first.
  // If interrupted before disabledModels is cleared,
  // DISABLE remains the safe effective authority.
  await setModelPolicy(
    target.providerAlias,
    target.modelId,
    normalizedState,
  );

  await enableModels(
    target.providerAlias,
    [target.modelId],
  );

  return getOperatorPolicy(
    target.providerAlias,
    target.modelId,
  );
}

const BULK_POLICY_LIMIT = 500;

function normalizeBulkTargets(targets) {
  if (
    !Array.isArray(targets)
    || targets.length === 0
  ) {
    throw new Error(
      "Bulk policy requires at least one target",
    );
  }

  if (targets.length > BULK_POLICY_LIMIT) {
    throw new Error(
      `Bulk policy supports at most ${BULK_POLICY_LIMIT} targets`,
    );
  }

  const deduped = new Map();

  for (const raw of targets) {
    const target =
      normalizeTarget(
        raw?.providerAlias,
        raw?.modelId,
      );

    deduped.set(
      `${target.providerAlias}\0${target.modelId}`,
      target,
    );
  }

  return [...deduped.values()];
}

function storedPolicyFromValue(value) {
  const parsed =
    parseJson(value, null);

  if (
    !parsed
    || typeof parsed !== "object"
    || Array.isArray(parsed)
  ) {
    return null;
  }

  const providerAlias =
    String(parsed.providerAlias || "").trim();

  const modelId =
    String(parsed.modelId || "").trim();

  const state =
    String(parsed.state || "").trim();

  if (
    !providerAlias
    || !modelId
    || !STORED_MODEL_POLICY_STATES.has(state)
  ) {
    return null;
  }

  return {
    providerAlias,
    modelId,
    state,
    updatedAt:
      parsed.updatedAt || null,
  };
}

export async function setOperatorPoliciesBulk({
  targets,
  state,
}) {
  const normalizedTargets =
    normalizeBulkTargets(targets);

  const normalizedState =
    String(state || "")
      .trim()
      .toLowerCase();

  if (
    !VALID_STATES.has(
      normalizedState,
    )
  ) {
    throw new Error(
      `Invalid operator policy state: ${normalizedState}`,
    );
  }

  const db =
    await getAdapter();

  let result = null;

  db.transaction(() => {
    const disabledRows =
      db.all(
        `SELECT key, value
           FROM kv
          WHERE scope = 'disabledModels'`,
      );

    const disabledByProvider =
      new Map();

    for (const row of disabledRows) {
      const ids =
        parseJson(row.value, []);

      disabledByProvider.set(
        row.key,
        new Set(
          Array.isArray(ids)
            ? ids
            : [],
        ),
      );
    }

    const policyRows =
      db.all(
        `SELECT key, value
           FROM kv
          WHERE scope = 'modelPolicies'`,
      );

    const storedByKey =
      new Map();

    for (const row of policyRows) {
      const policy =
        storedPolicyFromValue(
          row.value,
        );

      if (policy) {
        storedByKey.set(
          modelPolicyKey(
            policy.providerAlias,
            policy.modelId,
          ),
          policy,
        );
      }
    }

    const transitions = [];
    const updatedAt =
      new Date().toISOString();

    for (const target of normalizedTargets) {
      const disabled =
        disabledByProvider
          .get(target.providerAlias);

      const key =
        modelPolicyKey(
          target.providerAlias,
          target.modelId,
        );

      const stored =
        storedByKey.get(key);

      const previousState =
        disabled?.has(target.modelId)
          ? "disable"
          : (
              stored?.state
              || "default"
            );

      transitions.push({
        ...target,
        from: previousState,
        to: normalizedState,
      });

      /*
       * First prepare modelPolicies intent.
       *
       * For ALLOW / DEPRIORITIZE / QUARANTINE,
       * write the new intent before clearing
       * disabledModels.
       *
       * Everything is inside one DB transaction,
       * so no partial state becomes externally
       * visible.
       */
      if (
        STORED_MODEL_POLICY_STATES.has(
          normalizedState,
        )
      ) {
        const policy = {
          ...target,
          state: normalizedState,
          updatedAt,
        };

        db.run(
          `INSERT INTO kv(
             scope,
             key,
             value
           )
           VALUES(
             'modelPolicies',
             ?,
             ?
           )
           ON CONFLICT(scope, key)
           DO UPDATE SET
             value = excluded.value`,
          [
            key,
            stringifyJson(policy),
          ],
        );

        storedByKey.set(
          key,
          policy,
        );
      } else {
        db.run(
          `DELETE FROM kv
            WHERE scope = 'modelPolicies'
              AND key = ?`,
          [key],
        );

        storedByKey.delete(key);
      }

      /*
       * Update the in-transaction disabledModels
       * projection. Actual provider rows are
       * written once per provider below.
       */
      let providerDisabled =
        disabledByProvider.get(
          target.providerAlias,
        );

      if (!providerDisabled) {
        providerDisabled = new Set();

        disabledByProvider.set(
          target.providerAlias,
          providerDisabled,
        );
      }

      if (normalizedState === "disable") {
        providerDisabled.add(
          target.modelId,
        );
      } else {
        providerDisabled.delete(
          target.modelId,
        );
      }
    }

    const touchedProviders =
      new Set(
        normalizedTargets.map(
          (target) =>
            target.providerAlias,
        ),
      );

    for (const providerAlias of touchedProviders) {
      const ids =
        [
          ...(
            disabledByProvider.get(
              providerAlias,
            )
            || []
          ),
        ];

      if (ids.length === 0) {
        db.run(
          `DELETE FROM kv
            WHERE scope = 'disabledModels'
              AND key = ?`,
          [providerAlias],
        );
      } else {
        db.run(
          `INSERT INTO kv(
             scope,
             key,
             value
           )
           VALUES(
             'disabledModels',
             ?,
             ?
           )
           ON CONFLICT(scope, key)
           DO UPDATE SET
             value = excluded.value`,
          [
            providerAlias,
            stringifyJson(ids),
          ],
        );
      }
    }

    const changed =
      transitions.filter(
        (item) =>
          item.from !== item.to,
      ).length;

    result = {
      state: normalizedState,
      requested: targets.length,
      applied: normalizedTargets.length,
      changed,
      unchanged:
        normalizedTargets.length
        - changed,
      transitions,
      updatedAt,
    };
  });

  return result;
}
