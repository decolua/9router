// Cycle guard for studio (custom) models pointing at combos.
//
// A studio model may use a combo as its target, but the combo must never lead
// back to that studio, directly or through nested combos and chained studio
// names. Both the model-editor API and the combos API use these helpers, and
// the editor form reuses them for a client-side precheck, so every message
// here avoids characters that render poorly in terminals.

export function buildComboIndex(combos) {
  const byName = new Map();
  for (const combo of combos || []) {
    if (!combo || typeof combo.name !== "string") continue;
    const members = Array.isArray(combo.models)
      ? combo.models.map((m) => String(m ?? "").trim()).filter(Boolean)
      : [];
    byName.set(combo.name, members);
  }
  return byName;
}

// Accepts a Map or a plain object of studio callName to raw target string.
export function buildStudioTargetMap(studios) {
  const map = new Map();
  const entries = studios instanceof Map
    ? [...studios.entries()]
    : Object.entries(studios || {});
  for (const [name, target] of entries) {
    const key = String(name ?? "").trim();
    if (!key) continue;
    const value = typeof target === "string" ? target : target?.targetModel;
    map.set(key, String(value ?? "").trim());
  }
  return map;
}

function normalizeSelfNames(callName, extraSelfNames) {
  const names = new Set();
  for (const n of [callName, ...(extraSelfNames || [])]) {
    const key = String(n ?? "").trim();
    if (key) names.add(key);
  }
  return names;
}

// Does combo `comboName` lead back to studio `callName`?
// Returns the offending chain (e.g. ["mix", "workhorse"]) or null.
export function findStudioCycle({ callName, comboName, combosByName, studioTargets, extraSelfNames = [] }) {
  const selfNames = normalizeSelfNames(callName, extraSelfNames);
  const start = String(comboName ?? "").trim();
  if (selfNames.size === 0 || !start) return null;
  if (selfNames.has(start)) return [start];

  const combos = combosByName instanceof Map ? combosByName : buildComboIndex(combosByName);
  const targets = studioTargets instanceof Map ? new Map(studioTargets) : buildStudioTargetMap(studioTargets);
  for (const self of selfNames) targets.delete(self);

  const comboVisiting = new Set();
  const studioVisiting = new Set();

  const visitTarget = (target, path) => {
    if (!target) return null;
    if (selfNames.has(target)) return [...path, target];
    if (target.includes("/")) return null;
    if (targets.has(target)) {
      if (studioVisiting.has(target)) return null;
      studioVisiting.add(target);
      const hit = visitTarget(targets.get(target), [...path, target]);
      studioVisiting.delete(target);
      return hit;
    }
    if (combos.has(target)) return visitCombo(target, path);
    return null;
  };

  const visitCombo = (name, path) => {
    if (comboVisiting.has(name)) return null;
    const members = combos.get(name);
    if (!members) return null;
    comboVisiting.add(name);
    for (const member of members) {
      const hit = visitTarget(member, [...path, name]);
      if (hit) {
        comboVisiting.delete(name);
        return hit;
      }
    }
    comboVisiting.delete(name);
    return null;
  };

  return visitCombo(start, []);
}

// Does studio `studioName` resolve (through chained studios and combos) to
// combo `comboName`? Used when saving a combo to reject members that would
// close a combo -> studio -> combo loop. Returns the chain or null.
export function studioReachesCombo({ studioName, comboName, combosByName, studioTargets }) {
  const start = String(studioName ?? "").trim();
  const wanted = String(comboName ?? "").trim();
  if (!start || !wanted) return null;

  const combos = combosByName instanceof Map ? combosByName : buildComboIndex(combosByName);
  const targets = studioTargets instanceof Map ? new Map(studioTargets) : buildStudioTargetMap(studioTargets);

  const comboVisiting = new Set();
  const studioVisiting = new Set();

  const visitTarget = (target, path) => {
    if (!target) return null;
    if (target === wanted) return [...path, target];
    if (target.includes("/")) return null;
    if (targets.has(target)) {
      if (studioVisiting.has(target)) return null;
      studioVisiting.add(target);
      const hit = visitTarget(targets.get(target), [...path, target]);
      studioVisiting.delete(target);
      return hit;
    }
    if (combos.has(target)) return visitCombo(target, path);
    return null;
  };

  const visitCombo = (name, path) => {
    if (name === wanted) return [...path, name];
    if (comboVisiting.has(name)) return null;
    const members = combos.get(name);
    if (!members) return null;
    comboVisiting.add(name);
    for (const member of members) {
      const hit = visitTarget(member, [...path, name]);
      if (hit) {
        comboVisiting.delete(name);
        return hit;
      }
    }
    comboVisiting.delete(name);
    return null;
  };

  if (studioVisiting.has(start)) return null;
  studioVisiting.add(start);
  const hit = visitTarget(targets.get(start) ?? "", [start]);
  studioVisiting.delete(start);
  return hit;
}

export function describeStudioCycle(chain) {
  if (!chain || chain.length === 0) return "";
  return `That combo leads back to this model (${chain.join(" -> ")}). Pick a different target.`;
}

export function describeComboCycle(chain) {
  if (!chain || chain.length === 0) return "";
  return `That model routes back into this combo (${chain.join(" -> ")}). Pick a different member.`;
}
