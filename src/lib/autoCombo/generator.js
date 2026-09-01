export const AUTO_COMBO_CLASSES = Object.freeze([
  "normal",
  "thinking",
  "code",
  "vision",
  "image",
  "video",
]);

export const LLM_AUTO_COMBO_CLASSES = Object.freeze([
  "normal",
  "thinking",
  "code",
  "vision",
]);

export const MEDIA_AUTO_COMBO_CLASSES = Object.freeze([
  "image",
  "video",
]);

const LLM_CLASSES =
  new Set(LLM_AUTO_COMBO_CLASSES);

const MEDIA_CLASSES =
  new Set(MEDIA_AUTO_COMBO_CLASSES);

function healthStatus(model) {
  const status =
    String(
      model?.health?.status ||
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

function latencyMs(model) {
  const value =
    Number(
      model?.health?.latencyMs,
    );

  return (
    Number.isFinite(value) &&
    value >= 0
  )
    ? value
    : null;
}

function healthRank(model) {
  return (
    healthStatus(model) ===
    "healthy"
  )
    ? 0
    : 1;
}

function compareCandidates(a, b) {
  const healthDiff =
    healthRank(a) -
    healthRank(b);

  if (healthDiff !== 0) {
    return healthDiff;
  }

  const aLatency =
    latencyMs(a);

  const bLatency =
    latencyMs(b);

  const aKnown =
    aLatency !== null;

  const bKnown =
    bLatency !== null;

  if (aKnown && !bKnown) {
    return -1;
  }

  if (!aKnown && bKnown) {
    return 1;
  }

  if (
    aKnown &&
    bKnown &&
    aLatency !== bLatency
  ) {
    return aLatency - bLatency;
  }

  return String(
    a.canonicalId || "",
  ).localeCompare(
    String(
      b.canonicalId || "",
    ),
  );
}

function providerIndex(snapshot) {
  const map =
    new Map();

  for (
    const provider of
    snapshot?.providers || []
  ) {
    if (provider?.providerId) {
      map.set(
        provider.providerId,
        provider,
      );
    }
  }

  return map;
}

function llmEligible(
  model,
  capabilityClass,
) {
  if (
    model?.providerId ===
    "veoaifree-web"
  ) {
    return false;
  }

  return (
    model?.autoModelEligible === true &&
    model?.llmRoutingEligible === true &&
    model?.capabilities?.[
      capabilityClass
    ] === true
  );
}

function mediaProviderEligible(
  provider,
) {
  // C.6.2's model-level autoModelEligible is
  // deliberately LLM-gated. Media therefore consumes
  // the provider-level opt-in/free-connectionless signal.
  return (
    provider?.autoModelEligible === true ||
    provider?.connectionless === true
  );
}

function mediaEligible(
  model,
  provider,
  capabilityClass,
) {
  return (
    mediaProviderEligible(provider) &&
    model?.capabilities?.[
      capabilityClass
    ] === true
  );
}

function eligibleForClass(
  model,
  provider,
  capabilityClass,
) {
  if (
    healthStatus(model) ===
    "unhealthy"
  ) {
    return false;
  }

  if (
    LLM_CLASSES.has(
      capabilityClass,
    )
  ) {
    return llmEligible(
      model,
      capabilityClass,
    );
  }

  if (
    MEDIA_CLASSES.has(
      capabilityClass,
    )
  ) {
    return mediaEligible(
      model,
      provider,
      capabilityClass,
    );
  }

  return false;
}

function nativeModelString(model) {
  return (
    `${model.providerId}/${model.modelId}`
  );
}

function displayName(
  capabilityClass,
) {
  return (
    "Auto " +
    capabilityClass
      .charAt(0)
      .toUpperCase() +
    capabilityClass.slice(1)
  );
}

export function buildAutoCombo(
  snapshot,
  capabilityClass,
) {
  if (
    !AUTO_COMBO_CLASSES.includes(
      capabilityClass,
    )
  ) {
    throw new Error(
      `Unsupported auto-combo class: ${capabilityClass}`,
    );
  }

  const providers =
    providerIndex(snapshot);

  const members =
    (snapshot?.models || [])
      .filter((model) => {
        return eligibleForClass(
          model,
          providers.get(
            model?.providerId,
          ),
          capabilityClass,
        );
      })
      .sort(compareCandidates)
      .map((model, index) => ({
        position:
          index + 1,

        canonicalId:
          model.canonicalId,

        providerId:
          model.providerId,

        modelId:
          model.modelId,

        model:
          nativeModelString(model),

        health: {
          status:
            healthStatus(model),

          latencyMs:
            latencyMs(model),
        },
      }));

  return {
    id:
      `auto::${capabilityClass}`,

    name:
      displayName(
        capabilityClass,
      ),

    capabilityClass,

    virtual:
      true,

    derived:
      true,

    persisted:
      false,

    manual:
      false,

    routingActive:
      false,

    nativeModelFormat:
      "provider/model",

    candidateCount:
      members.length,

    models:
      members.map(
        (member) =>
          member.model,
      ),

    members,
  };
}

export function generateAutoCombos(
  snapshot,
) {
  const sourceTimestamp =
    snapshot?.refreshedAt ||
    snapshot?.generatedAt ||
    null;

  const combos =
    AUTO_COMBO_CLASSES.map(
      (capabilityClass) =>
        buildAutoCombo(
          snapshot,
          capabilityClass,
        ),
    );

  return {
    version: 1,

    generatedAt:
      sourceTimestamp,

    sourceInventoryRefreshedAt:
      sourceTimestamp,

    sourceInventoryModelCount:
      snapshot?.modelCount ??
      snapshot?.models?.length ??
      0,

    state:
      "virtual-derived-rebuildable",

    persistence:
      "none",

    databaseMutation:
      false,

    manualComboOverwrite:
      false,

    autoRoutingDecision:
      false,

    comboCount:
      combos.length,

    classes:
      [...AUTO_COMBO_CLASSES],

    combos,
  };
}
