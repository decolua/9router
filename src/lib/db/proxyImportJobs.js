// In-memory proxy-import job store.
//
// Why a server-side job at all: the batch import used to be a loop of client
// POSTs driven by the page component. That loop died with the tab - closing the
// browser, refreshing, or navigating away mid-import stopped it halfway and
// left the operator with pools half-written and no way to resume. "Run in
// background" only ever meant "keep running while this tab stays open".
//
// The job now runs here, on the server, kicked off with setImmediate. The
// browser polls for progress and can leave. That is the same shape as
// importJobs.js (the database restore job), which is why this lives beside it
// rather than in a new subsystem.
//
// Process-local on purpose, same as importJobs: progress is polled by the same
// server that accepted the POST, and a 9router restart legitimately abandons
// an in-flight import. Records are kept for RESULT_TTL_MS after completion so
// the dashboard can show the outcome of a run the operator stopped watching.
import { randomUUID } from "node:crypto";

const RESULT_TTL_MS = 15 * 60 * 1000;
// How often the client is told to poll. Fast enough to feel live, slow enough
// that a forgotten tab costs almost nothing.
export const PROXY_IMPORT_POLL_MS = 1000;

function getStore() {
  if (!globalThis._proxyImportJobs) globalThis._proxyImportJobs = new Map();
  return globalThis._proxyImportJobs;
}

function getTimers() {
  if (!globalThis._proxyImportJobsTimers) globalThis._proxyImportJobsTimers = new Map();
  return globalThis._proxyImportJobsTimers;
}

function touch(job) {
  job.updatedAt = new Date().toISOString();
}

/**
 * A proxy URL in the one shape two spellings of the same proxy agree on:
 * scheme and host lowercased, the port made explicit, no trailing slash.
 * Credentials are part of the identity - a rotating provider hands out the same
 * host:port with different user:pass, and those are different proxies.
 * Anything unparseable falls back to the trimmed lowercase string, so a malformed
 * URL still cancels out against its own exact repeat.
 */
function normalizeProxyUrl(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  try {
    const url = new URL(value);
    const scheme = url.protocol.toLowerCase();
    const host = url.hostname.toLowerCase();
    const port =
      url.port || (scheme === "https:" ? "443" : scheme === "http:" ? "80" : "");
    const auth = url.username
      ? `${url.username}${url.password ? `:${url.password}` : ""}@`
      : "";
    return `${scheme}//${auth}${host}${port ? `:${port}` : ""}`;
  } catch {
    return value.toLowerCase();
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

/**
 * Claim a queued job and run it to completion. One job runs at a time per
 * process: two concurrent bulk inserts of proxy pools race on the same
 * uniqueness check and report a confusing mix of created and skipped rows.
 */
let running = false;

async function drainQueue() {
  if (running) return;
  const store = getStore();
  const next = [...store.values()].find((j) => j.status === "queued");
  if (!next) return;

  running = true;
  next.status = "running";
  next.message = "Import started";
  touch(next);

  try {
    const { createProxyPools, getProxyPools } = await import("@/models");

    const total = Array.isArray(next.entries) ? next.entries.length : 0;
    let created = 0;
    let failed = 0;
    let processed = 0;

    // What makes two rows the same proxy is the URL, not the name. The client
    // derives a name from the host, so every line sharing a host:port - the
    // normal shape of a provider that rotates credentials - arrived with an
    // identical name, and skipping on the NAME dropped all but the first line of
    // a pasted list. Skip on the URL now; a repeated name only gets a numeric
    // suffix so the rows stay tellable apart. The table has no uniqueness
    // constraint, and none is added here.
    const existingPools = await getProxyPools();
    const existingUrls = new Set(
      existingPools.map((p) => normalizeProxyUrl(p.proxyUrl)).filter(Boolean)
    );
    const takenNames = new Set(
      existingPools.map((p) => String(p.name || "").trim()).filter(Boolean)
    );

    const uniqueName = (base) => {
      const name = String(base || "").trim() || "Imported proxy";
      if (!takenNames.has(name)) {
        takenNames.add(name);
        return name;
      }
      for (let n = 2; n < 10000; n += 1) {
        const candidate = `${name} #${n}`;
        if (!takenNames.has(candidate)) {
          takenNames.add(candidate);
          return candidate;
        }
      }
      const fallback = `${name} #${Date.now().toString(36)}`;
      takenNames.add(fallback);
      return fallback;
    };

    let skipped = 0;
    const CHUNK_SIZE = 50;
    let pendingBatch = [];

    const flushBatch = async () => {
      if (pendingBatch.length === 0) return;
      try {
        await createProxyPools(pendingBatch);
        created += pendingBatch.length;
      } catch (err) {
        failed += pendingBatch.length;
        if (failed === pendingBatch.length) next.error = err?.message || "Failed to create a proxy pool";
      }
      pendingBatch = [];
    };

    for (const entry of next.entries || []) {
      if (next.cancelRequested) {
        await flushBatch();
        next.status = "cancelled";
        next.message = `Stopped after ${processed}/${total}`;
        next.counts = { created, skipped, failed, processed, total };
        next.entries = null;
        touch(next);
        return;
      }

      const key = normalizeProxyUrl(entry.proxyUrl);
      if (key && existingUrls.has(key)) {
        skipped += 1;
      } else {
        pendingBatch.push({
          name: uniqueName(entry.name),
          proxyUrl: entry.proxyUrl,
          noProxy: "",
          type: "http",
          isActive: true,
        });
        if (key) existingUrls.add(key);
      }

      processed += 1;

      if (pendingBatch.length >= CHUNK_SIZE) {
        await flushBatch();
        next.progress = total > 0 ? Math.round((processed / total) * 100) : 100;
        next.message = `${processed}/${total} proxies`;
        next.counts = { created, skipped, failed, processed, total };
        touch(next);
        // Yield to event loop so status polls and other requests are serviced immediately
        await new Promise((resolve) => setImmediate(resolve));
      } else if (processed % 20 === 0 || processed === total) {
        next.progress = total > 0 ? Math.round((processed / total) * 100) : 100;
        next.message = `${processed}/${total} proxies`;
        next.counts = { created, skipped, failed, processed, total };
        touch(next);
      }
    }

    await flushBatch();

    next.progress = 100;
    next.status = "done";
    next.message = `Imported ${created}` + (skipped ? `, skipped ${skipped} duplicate` : "") +
      (failed ? `, failed ${failed}` : "");
    next.counts = { created, skipped, failed, processed, total };
    // The entries are the bulk of the record; drop them once counted.
    next.entries = null;
    touch(next);
  } catch (err) {
    next.status = "error";
    next.message = "Import failed";
    next.error = err?.message || "Failed to import proxies";
    next.entries = null;
    touch(next);
  } finally {
    running = false;
    scheduleResultCleanup(next.id);
  }

  // A job queued behind this one starts now.
  setImmediate(drainQueue);
}

/**
 * Queue a batch import. `entries` is the already-parsed and validated list:
 * parsing stays on the client so the operator still sees a per-line format
 * error before anything is queued.
 */
export function createProxyImportJob(entries) {
  const list = Array.isArray(entries) ? entries : [];
  if (list.length === 0) throw new Error("Nothing to import");

  const now = new Date().toISOString();
  const jobId = randomUUID();
  getStore().set(jobId, {
    id: jobId,
    status: "queued",
    progress: 0,
    message: `0/${list.length} proxies`,
    counts: { created: 0, skipped: 0, failed: 0, processed: 0, total: list.length },
    error: null,
    entries: list,
    cancelRequested: false,
    createdAt: now,
    updatedAt: now,
  });

  if (typeof setImmediate === "function") setImmediate(drainQueue);
  else setTimeout(drainQueue, 0);

  return { jobId, status: "queued", total: list.length };
}

export function getProxyImportJob(jobId) {
  if (!jobId) return null;
  const job = getStore().get(jobId);
  if (!job) return null;
  // `entries` never leaves the server: it is the pasted proxy list, and a poll
  // response is not the place to echo credentials back.
  const { entries, ...rest } = job;
  return rest;
}

export function cancelProxyImportJob(jobId) {
  const job = getStore().get(jobId);
  if (!job) return false;
  if (job.status === "queued" || job.status === "running") {
    job.cancelRequested = true;
    touch(job);
  }
  return true;
}

/** Every job the dashboard may want to reattach to after a reload. */
export function listProxyImportJobs() {
  return [...getStore().values()]
    .map(({ entries, ...rest }) => rest)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}
