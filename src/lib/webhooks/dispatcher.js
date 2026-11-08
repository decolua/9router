// Bounded durable webhook dispatcher.
//
// Ownership: webhookDeliveriesRepo owns claim/lease/generation/revision/
// revocation; this module only owns the poll loop, request building, response
// classification, retry timing and the events.js sink -> outbox wiring.
// No SQL here, no per-delivery timers, no recursive alert events.
import { WEBHOOK_LIMITS } from "@/shared/constants/webhooks.js";
import { completeWebhookDelivery, claimNextWebhookDelivery, enqueueWebhookEvent, getWebhookDeliveryDestination } from "@/lib/db/repos/webhookDeliveriesRepo.js";
import { setWebhookSink } from "./events.js";
import { sendWebhook } from "./transport.js";
import { buildDiscordPayload, buildGenericPayload, buildSlackPayload, classifyResponse } from "./adapters.js";
const GLOBAL_KEY = "_webhookDispatcher";
const DEFAULT_INTERVAL_MS = 1000;
const MAX_CONCURRENCY = 2;
const MAX_BACKOFF_MS = 3_600_000;
const BASE_BACKOFF_MS = 5000;
const MAX_DATE_MS = 8_640_000_000_000_000;
const iso = (now) => new Date(now).toISOString();
const degradation = { enqueueFailures: 0, lastErrorClass: null };

export function recordWebhookEnqueueFailure(code) {
  degradation.enqueueFailures = Math.min(Number.MAX_SAFE_INTEGER, degradation.enqueueFailures + 1);
  degradation.lastErrorClass = ["outbox_full", "storage_error"].includes(code) ? code : "internal";
  return degradation.lastErrorClass;
}

export function getWebhookDegradation() {
  return { ...degradation };
}
// Full jitter: min(3600s, random * 5s * 2^(attempt-1)). Attempt is the one
// that just failed; non-positive values are treated as the first attempt.
export function retryDelayMs(attempt, random = Math.random) {
  const number = Number.isInteger(attempt) && attempt > 0 ? attempt : 1;
  const window = BASE_BACKOFF_MS * 2 ** (number - 1);
  return Math.min(MAX_BACKOFF_MS, Math.floor(random() * window));
}
function safeCode(error) {
  const code = error?.code;
  return typeof code === "string" && /^[a-z0-9_]+$/i.test(code) ? code : "internal";
}
function makeDiagnostic(logger) {
  const warn = typeof logger?.warn === "function" ? logger.warn.bind(logger) : null;
  return (code) => {
    try { warn?.("[Webhooks] dispatcher diagnostic", { code }); } catch { /* local only */ }
  };
}
// Cooldown summaries belong to the human-facing Discord/Slack text only. The
// generic Standard Webhooks body must stay the exact catalog envelope, so it is
// never rewritten here.
function withSuppressedSummary(kind, built, suppressedCount) {
  const count = Number(suppressedCount) || 0;
  if (count < 1 || (kind !== "discord" && kind !== "slack")) return built;
  try {
    const payload = JSON.parse(built.body);
    const note = `${count} earlier alert${count === 1 ? "" : "s"} suppressed by cooldown`;
    if (kind === "discord") {
      const embed = Array.isArray(payload.embeds) ? payload.embeds[0] : null;
      if (!embed) return built;
      embed.description = [embed.description, note].filter(Boolean).join("\n\n");
    } else {
      payload.text = [payload.text, note].filter(Boolean).join("\n\n");
    }
    const body = JSON.stringify(payload);
    if (Buffer.byteLength(body, "utf8") > WEBHOOK_LIMITS.maxPayloadBytes) return built;
    return { ...built, body };
  } catch {
    return built;
  }
}
// sendWebhook has no query input; append adapter query to the persisted URL.
export function buildDestinationRequest(destination, event, now = Date.now(), signal) {
  let built;
  if (destination.kind === "discord") built = buildDiscordPayload(event);
  else if (destination.kind === "slack") built = buildSlackPayload(event);
  else {
    built = buildGenericPayload(event, {
      signingSecret: destination.signingSecret,
      webhookId: event.id,
      timestamp: Math.floor(now / 1000),
    });
  }
  built = withSuppressedSummary(destination.kind, built, destination.suppressedCount ?? event.suppressedCount);
  const url = new URL(destination.url);
  for (const [key, value] of Object.entries(built.query || {})) url.searchParams.set(key, value);
  const request = {
    url: url.toString(),
    body: built.body,
    headers: { ...(destination.headers || {}), ...built.headers },
    allowPrivateNetwork: destination.allowPrivateNetwork === true,
    signal,
  };
  if (destination.kind === "discord" || destination.kind === "slack") {
    request.acknowledgementKind = destination.kind;
  }
  return request;
}
function retryCompletion(classification, lease, now, random, lastStatus, errorClass) {
  const seconds = classification.retryAfterSeconds;
  const delay = Number.isFinite(seconds) && seconds >= 0
    ? seconds * 1000
    : retryDelayMs(lease.attempts, random);
  const next = now + delay;
  // An unrepresentable server delay can only expire the item. Using the item
  // deadline keeps the timestamp valid and never schedules an earlier retry.
  const nextAttemptAt = Number.isFinite(next) && next >= 0 && next <= MAX_DATE_MS
    ? iso(next)
    : (lease.expiresAt ?? iso(now + MAX_BACKOFF_MS));
  return {
    status: "retry",
    nextAttemptAt,
    lastStatus,
    lastErrorClass: errorClass,
  };
}
function completionForResponse(kind, response, lease, now, random) {
  const classification = classifyResponse(kind, response, { now });
  const lastStatus = Number.isInteger(response?.status) ? response.status : null;
  if (classification.outcome === "delivered") return { status: "delivered", lastStatus };
  if (classification.outcome === "terminal") {
    const internal = ["invalid_ack", "invalid_kind", "invalid_response"].includes(classification.reason);
    return { status: "failed", lastStatus, lastErrorClass: internal ? "internal" : "upstream_http" };
  }
  return retryCompletion(
    classification, lease, now, random, lastStatus,
    classification.reason === "timeout" ? "upstream_timeout" : "upstream_http",
  );
}
function completionForError(error, lease, now, random) {
  const code = error?.code;
  if (code === "WEBHOOK_TIMEOUT") {
    return retryCompletion({ reason: "timeout" }, lease, now, random, null, "upstream_timeout");
  }
  if (code === "WEBHOOK_NETWORK") {
    return retryCompletion({ reason: "network" }, lease, now, random, null, "upstream_network");
  }
  return { status: "failed", lastStatus: null, lastErrorClass: "internal" };
}
function finalOutcome(completion, lease) {
  if (completion.status !== "retry") return completion.status;
  const next = Date.parse(completion.nextAttemptAt);
  const expires = Date.parse(lease.expiresAt);
  if (Number.isFinite(next) && Number.isFinite(expires) && next >= expires) return "expired";
  if (Number(lease.attempts) >= 8) return "failed";
  return "retry";
}
async function applyCompletion(lease, completion, now) {
  const outcome = finalOutcome(completion, lease);
  try {
    const result = await completeWebhookDelivery(lease, completion, { now });
    return { applied: result?.ok === true && result.applied === true, status: outcome };
  } catch {
    return { applied: false, status: outcome };
  }
}
export async function deliverWebhookLease(lease, deps = {}) {
  const now = deps.now ?? Date.now;
  const random = deps.random ?? Math.random;
  const send = deps.send ?? sendWebhook;
  const destination = await getWebhookDeliveryDestination(lease, { now: now() });
  if (!destination) return { sent: false, applied: false, outcome: "skipped", reason: "stale" };
  if (deps.signal?.aborted) return { sent: false, applied: false, outcome: "aborted", reason: "aborted" };
  let response;
  try {
    const request = buildDestinationRequest(
      { ...destination, suppressedCount: lease.suppressedCount },
      lease.payload,
      now(),
      deps.signal,
    );
    response = await send(request);
  } catch (error) {
    if (error?.code === "WEBHOOK_ABORTED") {
      return { sent: true, applied: false, outcome: "aborted", reason: "aborted" };
    }
    const completion = completionForError(error, lease, now(), random);
    const finished = await applyCompletion(lease, completion, now());
    return { sent: true, applied: finished.applied, outcome: finished.status };
  }
  const completion = completionForResponse(destination.kind, response, lease, now(), random);
  const finished = await applyCompletion(lease, completion, now());
  return { sent: true, applied: finished.applied, outcome: finished.status };
}
export function createWebhookDispatcher(options = {}) {
  const intervalMs = Number.isFinite(options.intervalMs) && options.intervalMs > 0
    ? options.intervalMs : DEFAULT_INTERVAL_MS;
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  const send = options.send ?? sendWebhook;
  const diagnose = makeDiagnostic(options.logger ?? console);
  let running = false;
  let paused = false;
  let timer = null;
  let ticking = false;
  let epoch = 0;
  const inflight = new Map();
  const sink = (event) => {
    // Synchronous handoff only: events.js `emitted` never means persisted.
    try {
      const pending = enqueueWebhookEvent(event);
      if (pending && typeof pending.then === "function") {
        pending.then((result) => {
          if (result && result.ok === false) diagnose("enqueue_" + recordWebhookEnqueueFailure(result.errors?.[0]?.code));
        }, () => diagnose("enqueue_" + recordWebhookEnqueueFailure("storage_error")));
      }
    } catch {
      diagnose("enqueue_" + recordWebhookEnqueueFailure("storage_error"));
    }
  };
  async function runTick() {
    if (paused) return { paused: true, claimed: 0, delivered: 0, retried: 0, failed: 0, applied: 0 };
    if (ticking) return { busy: true, claimed: 0, delivered: 0, retried: 0, failed: 0, applied: 0 };
    const tickEpoch = epoch;
    ticking = true;
    const summary = { claimed: 0, delivered: 0, retried: 0, failed: 0, applied: 0 };
    const work = [];
    try {
      while (summary.claimed < MAX_CONCURRENCY) {
        let lease;
        try {
          lease = await claimNextWebhookDelivery({ now: now() });
        } catch (error) {
          diagnose("claim_" + safeCode(error));
          break;
        }
        if (!lease) break;
        if (epoch !== tickEpoch) break;
        summary.claimed += 1;
        const abort = new AbortController();
        inflight.set(lease.id, { abort, destinationId: lease.destinationId });
        work.push(
          deliverWebhookLease(lease, { now, random, send, signal: abort.signal })
            .then((result) => {
              if (result.applied) summary.applied += 1;
              if (!result.applied) return;
              if (result.outcome === "delivered") summary.delivered += 1;
              else if (result.outcome === "retry") summary.retried += 1;
              else if (result.outcome === "failed" || result.outcome === "expired") summary.failed += 1;
            }, (error) => diagnose("send_" + safeCode(error)))
            .finally(() => inflight.delete(lease.id)),
        );
      }
      if (work.length > 0) await Promise.allSettled(work);
    } finally {
      ticking = false;
    }
    return summary;
  }
  function abortAll() {
    for (const entry of [...inflight.values()]) entry.abort.abort();
  }
  return {
    start() {
      if (running) return false;
      running = true;
      paused = false;
      setWebhookSink(sink);
      timer = setInterval(() => {
        runTick().catch((error) => diagnose("tick_" + safeCode(error)));
      }, intervalMs);
      if (typeof timer?.unref === "function") timer.unref();
      return true;
    },
    stop() {
      if (!running) return false;
      running = false;
      paused = false;
      epoch += 1;
      if (timer) clearInterval(timer);
      timer = null;
      setWebhookSink(null);
      abortAll();
      return true;
    },
    pause() {
      if (!running || paused) return false;
      paused = true;
      epoch += 1;
      return true;
    },
    resume() {
      if (!running || !paused) return false;
      paused = false;
      return true;
    },
    isRunning: () => running,
    isPaused: () => paused,
    inflightCount: () => inflight.size,
    abortDestination(destinationId) {
      let aborted = 0;
      for (const entry of [...inflight.values()]) {
        if (entry.destinationId !== destinationId) continue;
        entry.abort.abort();
        aborted += 1;
      }
      return aborted;
    },
    tick: runTick,
  };
}
export function getWebhookDispatcher() {
  const controller = globalThis[GLOBAL_KEY];
  return controller && typeof controller.tick === "function" ? controller : null;
}
export function startWebhookDispatcher(options = {}) {
  const existing = getWebhookDispatcher();
  if (existing) {
    existing.start();
    return existing;
  }
  const controller = createWebhookDispatcher(options);
  globalThis[GLOBAL_KEY] = controller;
  controller.start();
  return controller;
}
export function stopWebhookDispatcher() {
  const existing = getWebhookDispatcher();
  if (!existing) return false;
  const stopped = existing.stop();
  globalThis[GLOBAL_KEY] = null;
  return stopped;
}
export function pauseWebhookDispatcher() {
  return getWebhookDispatcher()?.pause() ?? false;
}
export function resumeWebhookDispatcher() {
  return getWebhookDispatcher()?.resume() ?? false;
}
// Best-effort socket abort for revocation. Repo revision/generation checks
// remain the authority; API/import callers still cancel rows transactionally.
export function abortWebhookDestination(destinationId) {
  return getWebhookDispatcher()?.abortDestination(destinationId) ?? 0;
}
