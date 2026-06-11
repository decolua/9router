const MAX_ALIAS_SUFFIX = 1000;

export function getCompatibleModelId(model) {
  const raw = model?.id || model?.name || model?.model;
  if (typeof raw !== "string") return null;
  const modelId = raw.trim();
  return modelId || null;
}

export function generateCompatibleModelAlias(modelId) {
  const parts = String(modelId).split("/").filter(Boolean);
  return parts[parts.length - 1] || String(modelId).trim();
}

export function resolveCompatibleModelAlias(modelId, {
  providerStorageAlias,
  providerDisplayAlias,
  usedAliases,
  usedModels,
}) {
  const fullModel = `${providerStorageAlias}/${modelId}`;
  if (usedModels.has(fullModel)) {
    return { status: "existing", fullModel };
  }

  const baseAlias = generateCompatibleModelAlias(modelId);
  if (!baseAlias) {
    return { status: "invalid", fullModel };
  }

  const candidates = [baseAlias, `${providerDisplayAlias}-${baseAlias}`];
  for (const alias of candidates) {
    if (!usedAliases.has(alias)) {
      return { status: "ready", alias, fullModel };
    }
  }

  for (let i = 2; i <= MAX_ALIAS_SUFFIX; i += 1) {
    const alias = `${providerDisplayAlias}-${baseAlias}-${i}`;
    if (!usedAliases.has(alias)) {
      return { status: "ready", alias, fullModel };
    }
  }

  return { status: "conflict", fullModel };
}

export function createCompatibleModelImportPlan(models, {
  providerStorageAlias,
  providerDisplayAlias,
  modelAliases,
}) {
  const usedAliases = new Set(Object.keys(modelAliases || {}));
  const usedModels = new Set(Object.values(modelAliases || {}));
  const plan = [];
  const skipped = {
    existing: 0,
    invalid: 0,
    conflict: 0,
  };

  for (const model of models || []) {
    const modelId = getCompatibleModelId(model);
    if (!modelId) {
      skipped.invalid += 1;
      continue;
    }

    const resolved = resolveCompatibleModelAlias(modelId, {
      providerStorageAlias,
      providerDisplayAlias,
      usedAliases,
      usedModels,
    });

    if (resolved.status !== "ready") {
      skipped[resolved.status] = (skipped[resolved.status] || 0) + 1;
      continue;
    }

    usedAliases.add(resolved.alias);
    usedModels.add(resolved.fullModel);
    plan.push({ modelId, alias: resolved.alias, fullModel: resolved.fullModel });
  }

  return { plan, skipped, fetched: Array.isArray(models) ? models.length : 0 };
}

export function formatCompatibleModelImportSummary({ fetched, imported, failed, skipped }) {
  const parts = [`Fetched ${fetched}`, `added ${imported}`];
  if (skipped?.existing) parts.push(`already existed ${skipped.existing}`);
  if (skipped?.conflict) parts.push(`alias conflicts ${skipped.conflict}`);
  if (skipped?.invalid) parts.push(`invalid ${skipped.invalid}`);
  if (failed) parts.push(`failed ${failed}`);
  return parts.join(", ");
}
