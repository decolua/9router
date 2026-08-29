import fs from "node:fs";
import path from "node:path";

import { getProviderConnections } from "../db/repos/connectionsRepo.js";
import { getDisabledModels } from "../db/repos/disabledModelsRepo.js";
import { getModelPolicies } from "../db/repos/modelPoliciesRepo.js";
import { isModelLockActive } from "../../../open-sse/services/accountFallback.js";

import { DATA_DIR } from "../dataDir.js";
import { classifyHealth } from "./health.js";

const CONTROL_CENTER_FILE =
  path.join(
    DATA_DIR,
    "model-control-center.json",
  );

const SELECTOR_QUARANTINE_FILE =
  "/opt/openclaw-hermes-os/runtime/model-selector/quarantine.json";

function readControlCenterSnapshot() {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(
        CONTROL_CENTER_FILE,
        "utf8",
      ),
    );

    const providers =
      parsed?.providers
      && typeof parsed.providers === "object"
        ? parsed.providers
        : {};

    return {
      syncedAt:
        parsed?.syncedAt || null,

      testedAt:
        parsed?.testedAt || null,

      providers,
    };
  } catch {
    return {
      syncedAt: null,
      testedAt: null,
      providers: {},
    };
  }
}

function readComboQuarantine() {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(
        SELECTOR_QUARANTINE_FILE,
        "utf8",
      ),
    );

    const now = Date.now();
    const active = new Set();

    for (const [model, until] of Object.entries(
      parsed || {},
    )) {
      const expiresAt = Date.parse(until);

      if (
        Number.isFinite(expiresAt)
        && expiresAt > now
      ) {
        active.add(model);
      }
    }

    return active;
  } catch {
    return new Set();
  }
}

function modelReferences(
  providerId,
  alias,
  modelId,
  fullModel,
) {
  return new Set(
    [
      modelId,
      fullModel,
      `${providerId}/${modelId}`,
      `${alias}/${modelId}`,
    ].filter(Boolean),
  );
}

function valueMatchesModel(
  value,
  references,
  modelId,
) {
  if (typeof value !== "string") {
    return false;
  }

  const normalized = value.trim();

  if (!normalized) {
    return false;
  }

  if (references.has(normalized)) {
    return true;
  }

  const slash = normalized.indexOf("/");

  if (slash >= 0) {
    return normalized.slice(slash + 1) === modelId;
  }

  return normalized === modelId;
}

function disabledForModel(
  disabled,
  providerId,
  alias,
  references,
  modelId,
) {
  const keys = new Set(
    [providerId, alias].filter(Boolean),
  );

  for (const key of keys) {
    const ids = disabled?.[key];

    if (!Array.isArray(ids)) {
      continue;
    }

    if (
      ids.some((id) =>
        valueMatchesModel(
          id,
          references,
          modelId,
        ))
    ) {
      return true;
    }
  }

  return false;
}

function quarantinedForCombo(
  quarantine,
  references,
  modelId,
) {
  for (const value of quarantine) {
    if (
      valueMatchesModel(
        value,
        references,
        modelId,
      )
    ) {
      return true;
    }
  }

  return false;
}

function explicitEnabledModels(connection) {
  const models =
    connection?.providerSpecificData
      ?.enabledModels;

  return Array.isArray(models)
    && models.length > 0
    ? models
    : null;
}

function connectionListsModel(
  connection,
  references,
  modelId,
) {
  const models =
    explicitEnabledModels(connection);

  if (!models) {
    return null;
  }

  return models.some((value) =>
    valueMatchesModel(
      value,
      references,
      modelId,
    ));
}

function buildConnectionSnapshot(
  connections,
  references,
  modelId,
) {
  let locked = 0;
  let explicit = 0;
  let explicitListsModel = 0;

  for (const connection of connections) {
    if (
      isModelLockActive(
        connection,
        modelId,
      )
    ) {
      locked += 1;
    }

    const listed =
      connectionListsModel(
        connection,
        references,
        modelId,
      );

    if (listed !== null) {
      explicit += 1;

      if (listed) {
        explicitListsModel += 1;
      }
    }
  }

  return {
    activeConnections:
      connections.length,

    unlockedConnections:
      connections.length - locked,

    modelLockedConnections:
      locked,

    connectionConfig: {
      implicitConnections:
        connections.length - explicit,

      explicitEnabledModelsConnections:
        explicit,

      explicitConnectionsListingModel:
        explicitListsModel,
    },
  };
}

export async function buildEffectiveModelSet() {
  const state =
    readControlCenterSnapshot();

  const [
    connections,
    disabled,
    storedPolicies,
  ] = await Promise.all([
    getProviderConnections({
      isActive: true,
    }),
    getDisabledModels(),
    getModelPolicies(),
  ]);

  const quarantine =
    readComboQuarantine();

  const storedPolicyByModel =
    new Map();

  for (const policy of storedPolicies) {
    storedPolicyByModel.set(
      `${policy.providerAlias}\0${policy.modelId}`,
      policy,
    );
  }

  const connectionsByProvider =
    new Map();

  for (const connection of connections) {
    const list =
      connectionsByProvider.get(
        connection.provider,
      ) || [];

    list.push(connection);

    connectionsByProvider.set(
      connection.provider,
      list,
    );
  }

  const providers = {};

  let totalModels = 0;
  let previewEligible = 0;
  let previewBlocked = 0;
  let operatorDisabled = 0;
  let comboQuarantined = 0;
  let allConnectionsLocked = 0;

  let policyExplicit = 0;
  let policyDefault = 0;
  let policyAllow = 0;
  let policyDeprioritize = 0;
  let policyQuarantine = 0;
  let policyDisable = 0;

  for (const [
    providerId,
    provider,
  ] of Object.entries(
    state.providers || {},
  )) {
    const alias =
      provider.alias || providerId;

    const providerConnections =
      connectionsByProvider.get(
        providerId,
      ) || [];

    const models = {};

    for (const [
      modelId,
      model,
    ] of Object.entries(
      provider.models || {},
    )) {
      totalModels += 1;

      const fullModel =
        model.fullModel
        || `${alias}/${modelId}`;

      const references =
        modelReferences(
          providerId,
          alias,
          modelId,
          fullModel,
        );

      const isDisabled =
        disabledForModel(
          disabled,
          providerId,
          alias,
          references,
          modelId,
        );

      const storedPolicy =
        isDisabled
          ? null
          : (
              storedPolicyByModel.get(
                `${alias}\0${modelId}`,
              )
              || storedPolicyByModel.get(
                `${providerId}\0${modelId}`,
              )
              || null
            );

      const operatorPolicyState =
        isDisabled
          ? "disable"
          : storedPolicy?.state || "default";

      const operatorPolicy = {
        state:
          operatorPolicyState,

        explicit:
          operatorPolicyState
          !== "default",

        source:
          isDisabled
            ? "disabledModels"
            : storedPolicy
              ? "modelPolicies"
              : "default",

        updatedAt:
          storedPolicy?.updatedAt
          || null,
      };

      if (
        operatorPolicyState === "default"
      ) {
        policyDefault += 1;
      } else {
        policyExplicit += 1;

        if (
          operatorPolicyState === "allow"
        ) {
          policyAllow += 1;
        }

        if (
          operatorPolicyState
          === "deprioritize"
        ) {
          policyDeprioritize += 1;
        }

        if (
          operatorPolicyState
          === "quarantine"
        ) {
          policyQuarantine += 1;
        }

        if (
          operatorPolicyState
          === "disable"
        ) {
          policyDisable += 1;
        }
      }

      const isComboQuarantined =
        quarantinedForCombo(
          quarantine,
          references,
          modelId,
        );

      const connection =
        buildConnectionSnapshot(
          providerConnections,
          references,
          modelId,
        );

      const reasons = [];

      if (model.stale) {
        reasons.push("stale");
      }

      if (isDisabled) {
        reasons.push(
          "operator_disabled",
        );
      }

      if (
        connection.activeConnections === 0
      ) {
        reasons.push(
          "no_active_connection",
        );
      } else if (
        connection.unlockedConnections
        === 0
      ) {
        reasons.push(
          "all_connections_model_locked",
        );
      }

      const effectivePreview =
        reasons.length === 0;

      const healthCategory =
        classifyHealth(model.health);

      const signals = [];

      if (healthCategory !== "ok") {
        signals.push(
          `health:${healthCategory}`,
        );
      }

      if (isComboQuarantined) {
        signals.push(
          "combo_selector_quarantine",
        );
      }

      if (
        connection.connectionConfig
          .explicitEnabledModelsConnections
        > 0
      ) {
        signals.push(
          "connection_enabled_models_configured",
        );
      }

      if (
        operatorPolicyState === "allow"
      ) {
        signals.push("policy:allow");
      }

      if (
        operatorPolicyState
        === "deprioritize"
      ) {
        signals.push(
          "policy:deprioritize",
        );
      }

      if (
        operatorPolicyState
        === "quarantine"
      ) {
        signals.push(
          "policy:quarantine",
        );
      }

      if (effectivePreview) {
        previewEligible += 1;
      } else {
        previewBlocked += 1;
      }

      if (isDisabled) {
        operatorDisabled += 1;
      }

      if (isComboQuarantined) {
        comboQuarantined += 1;
      }

      if (
        connection.activeConnections > 0
        && connection.unlockedConnections
          === 0
      ) {
        allConnectionsLocked += 1;
      }

      models[modelId] = {
        id: modelId,
        name: model.name || modelId,
        kind: model.kind || "llm",
        fullModel,

        registryKnown:
          model.configured === true,

        runtimeDiscovered:
          model.discovered === true,

        custom:
          model.custom === true,

        stale:
          model.stale === true,

        source:
          model.source || null,

        availabilityKnown:
          model.availabilityKnown === true,

        connectionsAvailable:
          model.connectionsAvailable || 0,

        connectionsQueried:
          model.connectionsQueried || 0,

        health: {
          category: healthCategory,
          status:
            model.health?.status || null,
          testedAt:
            model.health?.testedAt || null,
          latencyMs:
            model.health?.latencyMs ?? null,
          statusCode:
            model.health?.statusCode ?? null,
        },

        operatorPolicy,

        operatorDisabled:
          isDisabled,

        comboContext: {
          quarantined:
            isComboQuarantined,
        },

        routingSnapshot: {
          activeConnections:
            connection.activeConnections,

          unlockedConnections:
            connection.unlockedConnections,

          modelLockedConnections:
            connection.modelLockedConnections,
        },

        connectionConfig:
          connection.connectionConfig,

        effectivePreview,
        reasons,
        signals,
      };
    }

    providers[providerId] = {
      providerId,
      alias,
      name:
        provider.name || providerId,

      activeConnections:
        providerConnections.length,

      models,
    };
  }

  return {
    v: 1,

    generatedAt:
      new Date().toISOString(),

    source: {
      syncedAt:
        state.syncedAt || null,

      testedAt:
        state.testedAt || null,
    },

    mode: "read-only-preview",

    authority: {
      routingChanged: false,
      healthIsRoutingAuthority: false,
      operatorPolicyIsRoutingAuthority:
        false,
      enabledModelsIsRoutingAuthority:
        false,
      comboQuarantineIsGlobalAuthority:
        false,
    },

    summary: {
      providers:
        Object.keys(providers).length,

      models:
        totalModels,

      previewEligible,
      previewBlocked,
      operatorDisabled,
      comboQuarantined,
      allConnectionsLocked,

      policyExplicit,
      policyDefault,
      policyAllow,
      policyDeprioritize,
      policyQuarantine,
      policyDisable,
    },

    limitations: [
      "Health is observational only.",
      "ALLOW, DEPRIORITIZE, and QUARANTINE are persisted operator intent only and are not used by the selector in Phase B.2.",
      "enabledModels is reported as connection configuration and is not treated as a direct-routing gate.",
      "Combo quarantine is contextual and is not treated as a global direct-routing gate.",
      "Antigravity live quota cache is not included in this preview.",
    ],

    providers,
  };
}
