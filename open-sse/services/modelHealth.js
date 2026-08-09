// Health-aware demotion: a model that keeps failing should stop being tried
// first, without being removed from the combo. Consecutive failures are the
// signal — a single blip is noise, a run of them is a sick model. One success
// clears the run, so a recovered model returns to its normal position on its
// own with no operator action.
//
// A success is not the only way back, and cannot be. Demotion moves a model
// behind the healthy ones, so while any of those keeps answering, the demoted
// model is never tried — and a model that is never tried can never succeed.
// Left there, three failures exile a model permanently, and a combo quietly
// collapses onto whichever entry was healthy when the trouble started. So the
// run also ages out: after a quiet spell the model returns to its natural
// position and gets one ordinary attempt. If it is still broken it is demoted
// again after a fresh run of failures, which costs one round trip per window.

const DEMOTE_AFTER = 3;

/** How long a failure run stands before the model is given another chance. */
export const DEMOTION_TTL_MS = 5 * 60 * 1000;

/** model -> { count, at } — `at` is the time of the most recent failure. */
const health = new Map();

// Reads the live run, dropping it if it has gone stale. Expiry is evaluated on
// read rather than on a timer: nothing needs to fire while the process is idle.
function liveRun(model, now) {
  const run = health.get(model);
  if (!run) return null;
  if (now - run.at >= DEMOTION_TTL_MS) {
    health.delete(model);
    return null;
  }
  return run;
}

export function recordModelFailure(model, now = Date.now()) {
  if (!model) return 0;
  // A failure after the window restarts the run rather than resuming it, so one
  // stale failure plus one fresh one can't add up to a demotion.
  const count = (liveRun(model, now)?.count ?? 0) + 1;
  health.set(model, { count, at: now });
  return count;
}

export function recordModelSuccess(model) {
  if (!model) return;
  health.delete(model);
}

export function isModelDemoted(model, threshold = DEMOTE_AFTER, now = Date.now()) {
  return (liveRun(model, now)?.count ?? 0) >= threshold;
}

export function modelFailureCount(model, now = Date.now()) {
  return liveRun(model, now)?.count ?? 0;
}

// Stable partition: healthy models keep their relative order and sick ones are
// appended in their original order. Never drops a model — demotion is a
// reordering, so a combo whose models are all sick still tries them all.
export function demoteUnhealthy(models, threshold = DEMOTE_AFTER, now = Date.now()) {
  if (!Array.isArray(models) || models.length <= 1) return models;
  const healthy = [];
  const sick = [];
  for (const m of models) {
    if (isModelDemoted(m, threshold, now)) sick.push(m);
    else healthy.push(m);
  }
  return sick.length ? [...healthy, ...sick] : models;
}

export function clearModelHealth() {
  health.clear();
}
