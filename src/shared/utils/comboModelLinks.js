// How a provider model links to the combos that use it.
//
// A model is reachable under several names — the storage alias, the display
// alias, the raw provider id, and any user alias — and a combo may have stored
// any of them. Every consumer must resolve the same set: if the dialog and the
// prune disagree, the dialog promises to remove a member the prune then fails
// to find, and the removal fails silently.
//
// Pure and I/O-free on purpose: the browser and the API route both import it.

export function modelCandidates({
  modelId,
  providerId,
  providerStorageAlias,
  providerDisplayAlias,
  alias,
  fullModel,
} = {}) {
  const out = [];
  const push = (value) => {
    if (value && !out.includes(value)) out.push(value);
  };
  push(fullModel);
  if (modelId) {
    for (const prefix of [providerDisplayAlias, providerStorageAlias, providerId]) {
      if (prefix) push(`${prefix}/${modelId}`);
    }
  }
  push(alias);
  return out;
}

export function buildComboIndex(combos) {
  const index = new Map();
  for (const combo of combos || []) {
    for (const member of combo?.models || []) {
      if (!member) continue;
      if (!index.has(member)) index.set(member, []);
      const names = index.get(member);
      if (!names.includes(combo.name)) names.push(combo.name);
    }
  }
  return index;
}

export function comboNamesForCandidates(index, candidates) {
  const seen = new Set();
  const out = [];
  for (const candidate of candidates || []) {
    for (const name of index.get(candidate) || []) {
      if (seen.has(name)) continue;
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

export function pruneMembers(members, candidates) {
  const set = candidates instanceof Set ? candidates : new Set(candidates || []);
  const kept = [];
  const removed = [];
  for (const member of members || []) {
    if (set.has(member)) removed.push(member);
    else kept.push(member);
  }
  return { kept, removed };
}

// A model used by a combo stays in the main list even while disabled: hiding it
// would leave the combo pointing at something absent from every list the user
// can see.
export function splitModelsByComboUsage(models, disabledIds, comboNamesForModel) {
  const disabled = disabledIds instanceof Set ? disabledIds : new Set(disabledIds || []);
  const visible = [];
  const hidden = [];
  for (const model of models || []) {
    if (!disabled.has(model.id)) {
      visible.push(model);
    } else if ((comboNamesForModel(model) || []).length > 0) {
      visible.push(model);
    } else {
      hidden.push(model);
    }
  }
  return { visible, hidden };
}
