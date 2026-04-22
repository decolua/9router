import { getSettings } from "@/lib/localDb";
import { normalizeQuotaSchedulerSettings } from "@/lib/quotaRefreshPlanner";
import { createQuotaRefreshState, QUOTA_REFRESH_RUN_STATES } from "@/lib/quotaRefreshState";

const appGlobal = global.__appSingleton ??= {};

export class QuotaRefreshScheduler {
  constructor({
    getSettingsFn = getSettings,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    now = () => new Date(),
    logger = console,
  } = {}) {
    this.getSettingsFn = getSettingsFn;
    this.setTimeoutFn = setTimeoutFn;
    this.clearTimeoutFn = clearTimeoutFn;
    this.now = now;
    this.logger = logger;
    this.state = createQuotaRefreshState({ now: () => this.now().toISOString() });
    this.settings = normalizeQuotaSchedulerSettings({});
    this.timerId = null;
    this.started = false;
    this.startPromise = null;
  }

  async loadSettings() {
    const settings = await this.getSettingsFn();
    this.settings = normalizeQuotaSchedulerSettings(settings?.quotaScheduler || {});
    return this.settings;
  }

  buildStatusSnapshot() {
    return {
      started: this.started,
      enabled: this.settings.enabled,
      settings: { ...this.settings },
      hasScheduledTimer: this.timerId !== null,
      ...this.getStateSnapshot(),
    };
  }

  getStateSnapshot() {
    return this.state.getSnapshot();
  }

  async getStatusSnapshot({ refreshSettings = false } = {}) {
    if (refreshSettings) {
      await this.loadSettings();
    }

    return this.buildStatusSnapshot();
  }

  isStarted() {
    return this.started;
  }

  async start() {
    if (this.startPromise) {
      return this.startPromise;
    }

    if (this.started) {
      return this;
    }

    this.startPromise = (async () => {
      this.started = true;
      try {
        await this.refreshSchedule("startup");
        return this;
      } catch (error) {
        this.started = false;
        this.clearScheduledTimer();
        throw error;
      }
    })();

    try {
      return await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  stop() {
    this.started = false;
    this.clearScheduledTimer();
    this.state.reset({ preserveLastRun: true });
    return this.getStateSnapshot();
  }

  async refreshSchedule(reason = "settings") {
    await this.loadSettings();

    if (!this.started || !this.settings.enabled) {
      this.clearScheduledTimer();
      this.state.setNextScheduledAt(null);
      return this.buildStatusSnapshot();
    }

    const nextScheduledAt = new Date(this.now().getTime() + this.settings.cadenceMs);
    this.scheduleAt(nextScheduledAt, reason);
    return this.buildStatusSnapshot();
  }

  async requestRestart(reason = "manual") {
    this.state.requestRestart(reason);
    return this.refreshSchedule(reason);
  }

  async requestManualRun(reason = "manual") {
    await this.loadSettings();

    if (!this.settings.enabled) {
      this.clearScheduledTimer();
      this.state.setNextScheduledAt(null);
      return {
        accepted: false,
        reason: "scheduler_disabled",
        snapshot: this.buildStatusSnapshot(),
      };
    }

    if (!this.started) {
      await this.start();
    }

    const status = this.state.getSnapshot().status;
    const mode = (
      status === QUOTA_REFRESH_RUN_STATES.RUNNING
      || status === QUOTA_REFRESH_RUN_STATES.CANCELLING
    )
      ? "restart_requested"
      : "run_triggered";

    if (mode === "restart_requested") {
      const snapshot = await this.requestRestart(reason);
      return {
        accepted: true,
        reason: mode,
        snapshot,
      };
    }

    this.clearScheduledTimer();
    this.state.setNextScheduledAt(null);
    const snapshot = await this.runScaffold(reason);
    return {
      accepted: true,
      reason: mode,
      snapshot,
    };
  }

  async runScaffold(trigger = "timer") {
    const { status } = this.state.getSnapshot();
    if (
      status === QUOTA_REFRESH_RUN_STATES.RUNNING
      || status === QUOTA_REFRESH_RUN_STATES.CANCELLING
    ) {
      this.state.requestRestart(`${trigger}:overlap`);
      return this.buildStatusSnapshot();
    }

    this.state.startRun({
      trigger,
      metadata: {
        scaffoldOnly: true,
        cadenceMs: this.settings.cadenceMs,
      },
      progress: {
        totalCount: 0,
        completedCount: 0,
        successCount: 0,
        errorCount: 0,
        skippedCount: 0,
      },
    });

    try {
      this.state.finishRun({
        trigger,
        outcome: "scaffold_only",
        note: "Quota refresh execution loop not implemented yet",
      });
    } catch (error) {
      this.logger.error?.("[QuotaRefreshScheduler] Scaffold run failed:", error);
      this.state.failRun(error);
    }

    const postRunSnapshot = this.state.getSnapshot();
    const pendingRestartReason = postRunSnapshot.restartRequested
      ? postRunSnapshot.lastRun?.restartReason || `${trigger}:restart`
      : null;

    if (pendingRestartReason && this.started && this.settings.enabled) {
      this.clearScheduledTimer();
      this.state.setNextScheduledAt(null);
      return this.runScaffold(pendingRestartReason);
    }

    if (this.started) {
      await this.refreshSchedule("post-run");
    }

    return this.buildStatusSnapshot();
  }

  scheduleAt(nextScheduledAt, reason = "schedule") {
    this.clearScheduledTimer();

    const delayMs = Math.max(0, nextScheduledAt.getTime() - this.now().getTime());
    this.state.setNextScheduledAt(nextScheduledAt.toISOString());
    this.timerId = this.setTimeoutFn(() => {
      this.timerId = null;
      this.runScaffold(reason).catch((error) => {
        this.logger.error?.("[QuotaRefreshScheduler] Timer run failed:", error);
        this.state.failRun(error);
      });
    }, delayMs);

    if (typeof this.timerId?.unref === "function") {
      this.timerId.unref();
    }

    return this.timerId;
  }

  clearScheduledTimer() {
    if (!this.timerId) return;
    this.clearTimeoutFn(this.timerId);
    this.timerId = null;
  }
}

export function getQuotaRefreshScheduler(options = {}) {
  if (!appGlobal.quotaRefreshScheduler) {
    appGlobal.quotaRefreshScheduler = new QuotaRefreshScheduler(options);
  }

  return appGlobal.quotaRefreshScheduler;
}
