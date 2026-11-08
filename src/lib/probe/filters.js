/**
 * Probe-backed capability filters for the model picker.
 *
 * Pure and dependency-free so the selection logic can be tested directly — the
 * picker component itself has no test harness, and this predicate is the part
 * that actually decides which models the user sees.
 */

/** Filter chips answered from real probe results, not the declared capability table. */
export const PROBE_FILTERS = [
  { key: "probe:ok", label: "Responds", icon: "check_circle", hint: "Returned a valid completion when actually called" },
  { key: "probe:rate_limited", label: "Rate limited", icon: "hourglass_top", hint: "Reachable but throttled (429 / quota message)" },
  { key: "probe:failed", label: "Failing", icon: "error", hint: "Errored for a reason other than throttling" },
  { key: "probe:vision", label: "Vision ✓", icon: "visibility", hint: "Accepted a real image and answered" },
  { key: "probe:tools", label: "Tools ✓", icon: "build", hint: "Actually emitted a tool_call when given a tool" },
  { key: "probe:audio", label: "Audio ✓", icon: "graphic_eq", hint: "Accepted a real audio clip and answered" },
];

export const PROBE_FILTER_KEYS = new Set(PROBE_FILTERS.map((f) => f.key));

export const isProbeFilter = (key) => PROBE_FILTER_KEYS.has(key);

/**
 * Does one model's probe result satisfy EVERY selected probe filter?
 *
 * Filters AND together: selecting "Responds" + "Tools ✓" means both must hold,
 * which is the point of the chip row — narrowing to models that clear several
 * bars at once.
 *
 * A model with no probe data fails every probe filter. These filters ask "did it
 * actually do this when called", and an unprobed model has no evidence either
 * way; treating unknown as a pass would quietly reintroduce the guesswork the
 * probes exist to replace.
 *
 * @param {Object|null|undefined} probe - stored probe result for the model
 * @param {Iterable<string>} selected - active filter keys (probe and non-probe mixed)
 * @returns {boolean}
 */
export function matchesProbeFilters(probe, selected) {
  for (const key of selected || []) {
    if (!isProbeFilter(key)) continue;
    if (!probe) return false;

    switch (key) {
      case "probe:ok":
        if (!probe.ok) return false;
        break;
      case "probe:rate_limited":
        if (probe.failureKind !== "rate_limited") return false;
        break;
      // "Failing" deliberately excludes throttled models: a rate-limited model
      // is healthy and will serve again later, so grouping it with genuine
      // failures would push the user to delete models that are fine.
      case "probe:failed":
        if (probe.ok || probe.failureKind === "rate_limited") return false;
        break;
      case "probe:vision":
        if (!probe.capabilities?.vision) return false;
        break;
      case "probe:tools":
        if (!probe.capabilities?.tools) return false;
        break;
      case "probe:audio":
        if (!probe.capabilities?.audioInput) return false;
        break;
      default:
        break;
    }
  }
  return true;
}

/**
 * Failure kinds that are a settled verdict about the model itself, so re-probing
 * them would only spend a real upstream call to be told the same thing.
 *
 * `auth` and `timeout` are deliberately NOT here: they describe the credential
 * or the connection, not the model, and a fixed key or a better network would
 * make them pass.
 */
const SETTLED_FAILURES = new Set(["error", "not_found"]);

/**
 * Should this model be probed again?
 *
 * Only a model that actually ANSWERED counts as done. A model that failed or was
 * rate-limited is probed again: one failure is often a transient upstream
 * hiccup, and treating it as permanent would silently strand a working model
 * outside the pool. Re-testing a model that already responded is the one case
 * worth skipping, since it costs a real upstream call for an answer we hold.
 *
 * Audio is exempt from the "already answered" shortcut: a probe recorded before
 * audio existed carries no verdict for it.
 *
 * @param {Object|null|undefined} probe - stored probe result
 * @param {{probeAudio?: boolean}} [opts]
 * @returns {boolean}
 */
export function needsProbing(probe, opts = {}) {
  const { probeAudio = false } = opts;
  if (!probe || probe.stale) return true;

  // A model that answered is settled - the one gap a stored success can have is
  // audio, when the verdict predates audio being probed.
  if (probe.ok) return probeAudio && probe.capabilities?.audioInput === undefined;

  // A failure that is a verdict about the MODEL - it errored, or does not exist -
  // is equally settled. "Confirmed unusable" needs no more re-testing than
  // "confirmed usable" does.
  if (SETTLED_FAILURES.has(probe.failureKind)) return false;

  // Everything left describes the credential or the network rather than the
  // model: rate limited, auth rejected, timed out. Those are retried, because a
  // later run may well succeed and skipping them would strand a working model.
  return true;
}
