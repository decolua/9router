// In-memory background import job store.
//
// Survives Next.js dev hot-reload via globalThis (same pattern as the db
// driver). Jobs are process-local on purpose: the dashboard polls the same
// server process that accepted the POST.
import { randomUUID } from "node:crypto";

const RESULT_TTL_MS = 10 * 60 * 1000;

function getStore() {
  if (!globalThis._importJobs) globalThis._importJobs = new Map();
  return globalThis._importJobs;
}

function getTimers() {
  if (!globalThis._importJobsTimers) globalThis._importJobsTimers = new Map();
  return globalThis._importJobsTimers;
}

function clearResultTimer(jobId) {
  const timers = getTimers();
  const timer = timers.get(jobId);
  if (timer) {
    clearTimeout(timer);
    timers.delete(jobId);
  }
}

function scheduleResultCleanup(jobId) {
  const timers = getTimers();
  if (timers.has(jobId)) return;
  const timer = setTimeout(() => {
    timers.delete(jobId);
    getStore().delete(jobId);
  }, RESULT_TTL_MS);
  if (typeof timer.unref === "function") timer.unref();
  timers.set(jobId, timer);
}

function touch(job) {
  job.updatedAt = new Date().toISOString();
}

async function runImportJob(jobId) {
  const store = getStore();
  const job = store.get(jobId);
  if (!job || job.status !== "queued") return;

  job.status = "running";
  job.message = "Import started";
  touch(job);

  try {
    const { importDbProgressive } = await import("./index.js");
    await importDbProgressive(job.payload, (progress) => {
      const current = store.get(jobId);
      if (!current) return;
      current.progress = progress;
      current.message = `Importing ${progress.currentSection} (${progress.done}/${progress.total})`;
      touch(current);
    });

    const current = store.get(jobId);
    if (!current) return;
    current.progress = {
      done: current.progress?.total ?? 0,
      total: current.progress?.total ?? 0,
      percent: 100,
      currentSection: "done",
    };
    current.payload = null;

    try {
      const { getSettings } = await import("./repos/settingsRepo.js");
      const { applyOutboundProxyEnv } = await import("../network/outboundProxy.js");
      const settings = await getSettings();
      applyOutboundProxyEnv(settings);
    } catch (err) {
      console.warn("[Settings][DatabaseImport] Failed to re-apply outbound proxy env:", err);
    }

    try {
      const { configureTelegramBackup } = await import("../../shared/services/telegramBackup.js");
      await configureTelegramBackup();
    } catch (err) {
      console.warn("[Settings][DatabaseImport] Failed to reschedule auto backup:", err?.message || err);
    }

    current.status = "done";
    current.message = "Import completed";
    touch(current);
  } catch (err) {
    const current = store.get(jobId);
    if (!current) return;
    current.status = "error";
    current.error = err?.message || "Failed to import database";
    current.message = "Import failed";
    current.payload = null;
    touch(current);
  } finally {
    scheduleResultCleanup(jobId);
  }
}

export function createImportJob(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Invalid database payload");
  }
  const jobId = randomUUID();
  const now = new Date().toISOString();
  getStore().set(jobId, {
    id: jobId,
    status: "queued",
    progress: { done: 0, total: 0, percent: 0, currentSection: "queued" },
    message: "Import queued",
    error: null,
    payload,
    createdAt: now,
    updatedAt: now,
  });
  if (typeof setImmediate === "function") setImmediate(() => runImportJob(jobId));
  else setTimeout(() => runImportJob(jobId), 0);
  return { jobId, status: "queued" };
}

export function getImportJob(jobId) {
  if (!jobId) return null;
  return getStore().get(jobId) || null;
}
