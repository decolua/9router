import { UPDATER_CONFIG } from "@/shared/constants/config";

/** Status endpoint exposed by the detached updater process (survives Next exit). */
export function getUpdaterStatusUrl(port = UPDATER_CONFIG.statusPort) {
  return `http://127.0.0.1:${port}/update/status`;
}

/**
 * Human-readable label for updater phase.
 * @param {string|null|undefined} phase
 * @param {{ attempt?: number, maxRetries?: number }} [meta]
 */
export function getUpdaterPhaseLabel(phase, meta = {}) {
  const attempt = meta.attempt || 0;
  const maxRetries = meta.maxRetries || UPDATER_CONFIG.installRetries;
  switch (phase) {
    case "starting":
      return "Starting updater…";
    case "waitingForExit":
      return "Stopping current app (releasing file locks)…";
    case "installing":
      return attempt > 0
        ? `Installing package (attempt ${attempt}/${maxRetries})…`
        : "Installing package…";
    case "done":
      return "Update complete — restarting app…";
    case "error":
      return "Update failed";
    default:
      return phase ? String(phase) : "Preparing…";
  }
}

/**
 * Coarse progress % for the overlay bar (not exact npm progress).
 * @param {{ phase?: string, attempt?: number, maxRetries?: number, done?: boolean, success?: boolean }} status
 */
export function getUpdaterProgressPercent(status) {
  if (!status || typeof status !== "object") return 5;
  const { phase, attempt = 0, maxRetries = UPDATER_CONFIG.installRetries, done, success } = status;
  if (done && success) return 100;
  if (phase === "error" || (done && !success)) return 90;
  switch (phase) {
    case "starting":
      return 8;
    case "waitingForExit":
      return 22;
    case "installing": {
      const safeMax = Math.max(1, maxRetries);
      const base = 35;
      const span = 50;
      const step = Math.min(attempt, safeMax) / safeMax;
      return Math.round(base + span * step);
    }
    case "done":
      return 100;
    default:
      return 5;
  }
}

/**
 * Whether auto-update finished successfully.
 * @param {object|null|undefined} status
 */
export function isUpdaterSuccess(status) {
  return !!(status && status.done && status.success);
}

/**
 * Whether auto-update finished with failure.
 * @param {object|null|undefined} status
 */
export function isUpdaterFailure(status) {
  return !!(status && (status.phase === "error" || (status.done && !status.success)));
}
