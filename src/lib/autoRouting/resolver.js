import {
  classifyAutoRoutingRequest,
} from "./classifier.js";

import {
  createAutoRoutingDecision,
} from "./decision.js";

async function defaultAutoComboLoader(
  id,
) {
  const {
    getAutoComboById,
  } =
    await import(
      "../autoCombo/service.js"
    );

  return getAutoComboById(
    id,
  );
}

async function defaultAdaptiveLoader(
  options,
) {
  const {
    buildAdaptiveFallbackRuntimeOrder,
  } =
    await import(
      "../modelControlCenter/adaptiveRuntime.js"
    );

  return (
    buildAdaptiveFallbackRuntimeOrder(
      options,
    )
  );
}

async function defaultCapabilityLoader(
  providerId,
  modelId,
) {
  const {
    getCapabilitiesForModel,
  } =
    await import(
      "open-sse/providers/capabilities.js"
    );

  return (
    getCapabilitiesForModel(
      providerId,
      modelId,
    ) || {}
  );
}

function normalizeRequiredCapabilities(
  value,
) {
  if (value instanceof Set) {
    return new Set(value);
  }

  if (Array.isArray(value)) {
    return new Set(
      value
        .filter(Boolean)
        .map(String),
    );
  }

  return new Set();
}

function nativeParts(model) {
  if (
    typeof model !== "string"
  ) {
    return null;
  }

  const slash =
    model.indexOf("/");

  if (
    slash <= 0 ||
    slash >=
      model.length - 1
  ) {
    return null;
  }

  return {
    providerId:
      model.slice(
        0,
        slash,
      ),

    modelId:
      model.slice(
        slash + 1,
      ),
  };
}

function healthStatus(
  member,
) {
  const status =
    String(
      member
        ?.health
        ?.status ||
      "unknown",
    ).toLowerCase();

  if (
    status === "healthy" ||
    status === "unhealthy"
  ) {
    return status;
  }

  return "unknown";
}

async function satisfiesRequiredCapabilities(
  model,
  required,
  capabilityLoader,
) {
  if (
    required.size === 0
  ) {
    return true;
  }

  const parts =
    nativeParts(model);

  if (!parts) {
    return false;
  }

  let capabilities;

  try {
    capabilities =
      await capabilityLoader(
        parts.providerId,
        parts.modelId,
      );
  } catch {
    return false;
  }

  for (
    const capability
    of required
  ) {
    if (
      capabilities
        ?.[capability]
        !== true
    ) {
      return false;
    }
  }

  return true;
}

function memberByModel(
  combo,
) {
  return new Map(
    (
      combo?.members ||
      []
    )
      .filter(
        (member) =>
          typeof member
            ?.model ===
          "string",
      )
      .map(
        (member) => [
          member.model,
          member,
        ],
      ),
  );
}

function stableHealthPartition(
  models,
  membersByModel,
) {
  const healthy = [];
  const unknown = [];

  for (
    const model
    of models
  ) {
    const status =
      healthStatus(
        membersByModel.get(
          model,
        ),
      );

    if (
      status === "healthy"
    ) {
      healthy.push(model);

    } else if (
      status !== "unhealthy"
    ) {
      unknown.push(model);
    }
  }

  return [
    ...healthy,
    ...unknown,
  ];
}

export async function resolveAutoRouting({
  routingToken,
  body = {},
  endpoint = "",
  routeKind = "chat",
  requiredCapabilities =
    new Set(),
  candidateFilter = null,
} = {}, {
  autoComboLoader =
    defaultAutoComboLoader,

  adaptiveLoader =
    defaultAdaptiveLoader,

  capabilityLoader =
    defaultCapabilityLoader,
} = {}) {
  const required =
    normalizeRequiredCapabilities(
      requiredCapabilities,
    );

  const classification =
    classifyAutoRoutingRequest({
      routingToken,
      body,
      endpoint,
      routeKind,
      requiredCapabilities:
        required,
    });

  if (
    !classification.matched
  ) {
    return {
      matched: false,
      available: false,
      reason:
        "NOT_AUTO_ROUTING_TOKEN",
      models: [],
      decision: null,
    };
  }

  const autoComboId =
    `auto::${classification.resolvedClass}`;

  const combo =
    await autoComboLoader(
      autoComboId,
    );

  if (
    !combo ||
    !Array.isArray(
      combo.members,
    )
  ) {
    const decision =
      createAutoRoutingDecision({
        classification,
        autoComboId,
        members: [],
        baseOrder: [],
        orderedModels: [],
        adaptiveRuntime:
          null,
        fallbackReason:
          "auto_combo_unavailable",
      });

    return {
      matched: true,
      available: false,
      reason:
        "AUTO_ROUTING_UNAVAILABLE",
      autoComboId,
      resolvedClass:
        classification
          .resolvedClass,
      models: [],
      decision,
    };
  }

  const admittedMembers =
    [];

  for (
    const member
    of combo.members
  ) {
    const model =
      member?.model;

    const parts =
      nativeParts(
        model,
      );

    if (!parts) {
      continue;
    }

    if (
      healthStatus(
        member,
      ) === "unhealthy"
    ) {
      continue;
    }

    if (
      classification
        .resolvedClass
        !== "video" &&
      parts.providerId ===
        "veoaifree-web"
    ) {
      continue;
    }

    if (
      !(
        await satisfiesRequiredCapabilities(
          model,
          required,
          capabilityLoader,
        )
      )
    ) {
      continue;
    }

    if (
      typeof candidateFilter ===
      "function"
    ) {
      let accepted =
        false;

      try {
        accepted =
          await candidateFilter({
            model,
            member,
            providerId:
              parts.providerId,
            modelId:
              parts.modelId,
            resolvedClass:
              classification
                .resolvedClass,
            routeKind,
          });
      } catch {
        accepted =
          false;
      }

      if (!accepted) {
        continue;
      }
    }

    admittedMembers.push(
      member,
    );
  }

  const baseOrder =
    admittedMembers.map(
      (member) =>
        member.model,
    );

  if (
    baseOrder.length === 0
  ) {
    const decision =
      createAutoRoutingDecision({
        classification,
        autoComboId,
        members:
          admittedMembers,
        baseOrder,
        orderedModels: [],
        adaptiveRuntime:
          null,
        fallbackReason:
          "zero_eligible_candidates",
      });

    return {
      matched: true,
      available: false,
      reason:
        "AUTO_ROUTING_UNAVAILABLE",
      autoComboId,
      resolvedClass:
        classification
          .resolvedClass,
      models: [],
      decision,
    };
  }

  const adaptiveRuntime =
    await adaptiveLoader({
      models:
        baseOrder,

      strategy:
        "fallback",

      comboName:
        autoComboId,

      capabilityPriorityModels:
        [],
    });

  const admittedSet =
    new Set(
      baseOrder,
    );

  const adaptiveModels =
    Array.isArray(
      adaptiveRuntime
        ?.models,
    )
      ? adaptiveRuntime
        .models
        .filter(
          (model) =>
            admittedSet.has(
              model,
            ),
        )
      : [...baseOrder];

  const blockedModels =
    Array.isArray(
      adaptiveRuntime
        ?.blockedModels,
    )
      ? adaptiveRuntime
        .blockedModels
        .map(
          (row) =>
            row?.model,
        )
        .filter(
          (model) =>
            admittedSet.has(
              model,
            ),
        )
      : [];

  const allBlocked =
    (
      blockedModels.length
      >= baseOrder.length
    ) &&
    baseOrder.length > 0;

  const membersByModel =
    memberByModel(
      combo,
    );

  /*
   * C.5 may reorder only inside the safety envelope.
   * Re-partition AFTER C.5 ordering so healthy candidates
   * can never be displaced behind unknown-health candidates.
   */
  const orderedModels =
    allBlocked
      ? []
      : stableHealthPartition(
          adaptiveModels,
          membersByModel,
        );

  const orderedMembers =
    orderedModels
      .map(
        (model) =>
          membersByModel.get(
            model,
          ),
      )
      .filter(Boolean);

  const decision =
    createAutoRoutingDecision({
      classification,
      autoComboId,
      members:
        orderedMembers,
      baseOrder,
      orderedModels,
      adaptiveRuntime,
      fallbackReason:
        orderedModels.length > 0
          ? null
          : "all_candidates_runtime_blocked",
    });

  return {
    matched: true,

    available:
      orderedModels.length > 0,

    reason:
      orderedModels.length > 0
        ? "AUTO_ROUTING_READY"
        : "AUTO_ROUTING_UNAVAILABLE",

    autoComboId,

    resolvedClass:
      classification
        .resolvedClass,

    models:
      orderedModels,

    decision,

    adaptiveRuntime,
  };
}
