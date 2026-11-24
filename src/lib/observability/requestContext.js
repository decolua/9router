import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

const storage = new AsyncLocalStorage();
export const currentInference = () => storage.getStore();
export const bindInference = callback => currentInference() ? AsyncLocalStorage.bind(callback) : callback;

export function startInference(request, run) {
  if (currentInference()) return run(currentInference());
  const clientId = request.headers?.get?.("x-request-id");
  const trace = {
    requestId: randomUUID(), started: Date.now(), attempts: 0, fallbacks: 0,
    ...(clientId && /^[A-Za-z0-9._:-]{8,128}$/.test(clientId) ? { clientRequestId: clientId } : {}),
  };
  return storage.run(trace, () => run(trace));
}

export function noteAttempt(provider, model, connectionId) {
  const t = currentInference();
  if (!t) return;
  if (t.attempts && (t.connectionId !== connectionId || t.model !== model || t.provider !== provider)) t.fallbacks++;
  Object.assign(t, { provider, model, connectionId, attempts: t.attempts + 1, failure: null });
}

export function usageTrace(entry) {
  const t = currentInference();
  if (!t) return entry;
  t.usageStarted = true;
  const status = t.failure ? "error" : entry.status;
  return { ...entry, status, requestId: t.requestId, meta: {
    usageReported: entry.usageReported ?? !!entry.tokens,
    attempts: t.attempts, fallbacks: t.fallbacks, finalConnectionId: entry.connectionId ?? null,
    latencyMs: Math.max(0, Date.now() - t.started), errorCategory: status === "error" ? t.failure?.category ?? "unknown" : null,
    ...(t.clientRequestId ? { clientRequestId: t.clientRequestId } : {}),
  } };
}
