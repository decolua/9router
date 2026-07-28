// Health-aware demotion: a model that keeps failing should stop being tried
// first, without being removed from the combo. Consecutive failures are the
// signal — a single blip is noise, a run of them is a sick model. One success
// clears the run, so a recovered model returns to its normal position on its
// own with no operator action.

const DEMOTE_AFTER = 3;

const health = new Map();

export function recordModelFailure(model) {
  if (!model) return 0;
  const n = (health.get(model) || 0) + 1;
  health.set(model, n);
  return n;
}

export function recordModelSuccess(model) {
  if (!model) return;
  health.delete(model);
}

export function isModelDemoted(model, threshold = DEMOTE_AFTER) {
  return (health.get(model) || 0) >= threshold;
}

export function modelFailureCount(model) {
  return health.get(model) || 0;
}

// Stable partition: healthy models keep their relative order and sick ones are
// appended in their original order. Never drops a model — demotion is a
// reordering, so a combo whose models are all sick still tries them all.
export function demoteUnhealthy(models, threshold = DEMOTE_AFTER) {
  if (!Array.isArray(models) || models.length <= 1) return models;
  const healthy = [];
  const sick = [];
  for (const m of models) {
    if (isModelDemoted(m, threshold)) sick.push(m);
    else healthy.push(m);
  }
  return sick.length ? [...healthy, ...sick] : models;
}

export function clearModelHealth() {
  health.clear();
}
