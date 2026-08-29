import {
  disableModels,
  enableModels,
  getDisabledModels,
} from "../db/repos/disabledModelsRepo.js";

import {
  deleteModelPolicy,
  getModelPolicies,
  getModelPolicy,
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
