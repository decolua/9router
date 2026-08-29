import { getAdapter } from "../driver.js";
import {
  parseJson,
  stringifyJson,
} from "../helpers/jsonCol.js";

const SCOPE = "modelPolicies";

export const STORED_MODEL_POLICY_STATES =
  new Set([
    "allow",
    "deprioritize",
    "quarantine",
  ]);

export function modelPolicyKey(
  providerAlias,
  modelId,
) {
  return [
    encodeURIComponent(providerAlias),
    encodeURIComponent(modelId),
  ].join("|");
}

function normalizeStoredPolicy(value) {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
  ) {
    return null;
  }

  const providerAlias =
    String(value.providerAlias || "").trim();

  const modelId =
    String(value.modelId || "").trim();

  const state =
    String(value.state || "").trim();

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
      value.updatedAt || null,
  };
}

export async function getModelPolicies() {
  const db = await getAdapter();

  const rows = db.all(
    `SELECT key, value
       FROM kv
      WHERE scope = ?`,
    [SCOPE],
  );

  const out = [];

  for (const row of rows) {
    const policy =
      normalizeStoredPolicy(
        parseJson(row.value, null),
      );

    if (policy) {
      out.push(policy);
    }
  }

  return out;
}

export async function getModelPolicy(
  providerAlias,
  modelId,
) {
  const db = await getAdapter();

  const row = db.get(
    `SELECT value
       FROM kv
      WHERE scope = ?
        AND key = ?`,
    [
      SCOPE,
      modelPolicyKey(
        providerAlias,
        modelId,
      ),
    ],
  );

  return row
    ? normalizeStoredPolicy(
        parseJson(row.value, null),
      )
    : null;
}

export async function setModelPolicy(
  providerAlias,
  modelId,
  state,
) {
  if (
    !providerAlias
    || !modelId
    || !STORED_MODEL_POLICY_STATES.has(state)
  ) {
    throw new Error(
      "Invalid stored model policy",
    );
  }

  const db = await getAdapter();

  const policy = {
    providerAlias,
    modelId,
    state,
    updatedAt:
      new Date().toISOString(),
  };

  db.run(
    `INSERT INTO kv(
       scope,
       key,
       value
     )
     VALUES(?, ?, ?)
     ON CONFLICT(scope, key)
     DO UPDATE SET
       value = excluded.value`,
    [
      SCOPE,
      modelPolicyKey(
        providerAlias,
        modelId,
      ),
      stringifyJson(policy),
    ],
  );

  return policy;
}

export async function deleteModelPolicy(
  providerAlias,
  modelId,
) {
  const db = await getAdapter();

  db.run(
    `DELETE FROM kv
      WHERE scope = ?
        AND key = ?`,
    [
      SCOPE,
      modelPolicyKey(
        providerAlias,
        modelId,
      ),
    ],
  );
}
