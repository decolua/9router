export const QUOTA_REFRESH_RUN_STATES = {
  IDLE: "idle",
  RUNNING: "running",
  CANCELLING: "cancelling",
  ERROR: "error",
};

function cloneValue(value) {
  if (value === null || value === undefined) return value;
  return JSON.parse(JSON.stringify(value));
}

function createEmptyProgress(overrides = {}) {
  return {
    totalCount: 0,
    completedCount: 0,
    successCount: 0,
    errorCount: 0,
    skippedCount: 0,
    ...overrides,
  };
}

function normalizeError(error) {
  if (!error) return null;
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack || null,
    };
  }

  return {
    message: typeof error === "string" ? error : "Unknown scheduler error",
    name: "Error",
    stack: null,
  };
}

export class QuotaRefreshState {
  constructor({ now = () => new Date().toISOString() } = {}) {
    this.now = now;
    this.runSequence = 0;
    this.snapshot = {
      status: QUOTA_REFRESH_RUN_STATES.IDLE,
      currentRun: null,
      lastRun: null,
      nextScheduledAt: null,
      cancelRequested: false,
      restartRequested: false,
      progress: createEmptyProgress(),
      error: null,
    };
  }

  getSnapshot() {
    return cloneValue(this.snapshot);
  }

  setNextScheduledAt(nextScheduledAt) {
    this.snapshot.nextScheduledAt = nextScheduledAt || null;
    return this.getSnapshot();
  }

  startRun(metadata = {}) {
    if (
      this.snapshot.status === QUOTA_REFRESH_RUN_STATES.RUNNING
      || this.snapshot.status === QUOTA_REFRESH_RUN_STATES.CANCELLING
    ) {
      throw new Error("Quota refresh run already in progress");
    }

    this.runSequence += 1;
    const startedAt = metadata.startedAt || this.now();
    const progress = createEmptyProgress(metadata.progress);
    this.snapshot.status = QUOTA_REFRESH_RUN_STATES.RUNNING;
    this.snapshot.cancelRequested = false;
    this.snapshot.restartRequested = false;
    this.snapshot.error = null;
    this.snapshot.progress = progress;
    this.snapshot.currentRun = {
      runId: metadata.runId || `quota-refresh-run-${this.runSequence}`,
      trigger: metadata.trigger || "manual",
      startedAt,
      metadata: cloneValue(metadata.metadata || {}),
      progress: cloneValue(progress),
    };

    return this.getSnapshot();
  }

  updateProgress(progressPatch = {}) {
    const nextProgress = createEmptyProgress({
      ...this.snapshot.progress,
      ...progressPatch,
    });

    this.snapshot.progress = nextProgress;
    if (this.snapshot.currentRun) {
      this.snapshot.currentRun.progress = cloneValue(nextProgress);
    }
    return this.getSnapshot();
  }

  requestCancel(reason = null) {
    this.snapshot.cancelRequested = true;
    if (this.snapshot.currentRun && this.snapshot.status === QUOTA_REFRESH_RUN_STATES.RUNNING) {
      this.snapshot.status = QUOTA_REFRESH_RUN_STATES.CANCELLING;
      this.snapshot.currentRun.cancelReason = reason || null;
    }
    return this.getSnapshot();
  }

  requestRestart(reason = null) {
    this.snapshot.restartRequested = true;
    if (this.snapshot.currentRun) {
      this.snapshot.currentRun.restartReason = reason || null;
    }
    return this.getSnapshot();
  }

  finishRun(result = {}) {
    const finishedAt = result.finishedAt || this.now();
    const currentRun = this.snapshot.currentRun;
    const finalRun = currentRun
      ? {
          ...currentRun,
          finishedAt,
          result: cloneValue(result),
          progress: cloneValue(this.snapshot.progress),
        }
      : null;

    this.snapshot.lastRun = finalRun;
    this.snapshot.currentRun = null;
    this.snapshot.status = QUOTA_REFRESH_RUN_STATES.IDLE;
    this.snapshot.cancelRequested = false;
    this.snapshot.progress = createEmptyProgress();
    this.snapshot.error = null;

    return this.getSnapshot();
  }

  failRun(error, metadata = {}) {
    const failedAt = metadata.failedAt || this.now();
    const normalizedError = normalizeError(error);
    const currentRun = this.snapshot.currentRun;

    this.snapshot.lastRun = currentRun
      ? {
          ...currentRun,
          failedAt,
          progress: cloneValue(this.snapshot.progress),
          error: normalizedError,
        }
      : null;
    this.snapshot.currentRun = null;
    this.snapshot.status = QUOTA_REFRESH_RUN_STATES.ERROR;
    this.snapshot.error = normalizedError;
    this.snapshot.cancelRequested = false;
    this.snapshot.progress = createEmptyProgress();

    return this.getSnapshot();
  }

  clearError() {
    this.snapshot.error = null;
    if (!this.snapshot.currentRun && this.snapshot.status === QUOTA_REFRESH_RUN_STATES.ERROR) {
      this.snapshot.status = QUOTA_REFRESH_RUN_STATES.IDLE;
    }
    return this.getSnapshot();
  }

  reset({ preserveLastRun = true } = {}) {
    this.snapshot.status = QUOTA_REFRESH_RUN_STATES.IDLE;
    this.snapshot.currentRun = null;
    this.snapshot.nextScheduledAt = null;
    this.snapshot.cancelRequested = false;
    this.snapshot.restartRequested = false;
    this.snapshot.progress = createEmptyProgress();
    this.snapshot.error = null;
    if (!preserveLastRun) {
      this.snapshot.lastRun = null;
    }
    return this.getSnapshot();
  }
}

export function createQuotaRefreshState(options) {
  return new QuotaRefreshState(options);
}
