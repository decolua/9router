// Opt-in transient operational events for account and token failures.
//
// Events own subscription filtering (outbox), not this helper. The helper only:
//   - projects a fixed scalar allowlist,
//   - coalesces concurrent duplicate emitters for the same
//     type|provider|connectionId inside a short burst window,
//   - swallows sink/callback failures so proxy flow never changes.
//
// The window is deliberately short: it absorbs bursts (for example, several
// concurrent requests failing the same connection) without becoming a
// destination-level suppression policy that would hide outbox counters.

import { emitWebhookEvent } from "@/lib/webhooks/events.js";

const DEDUP_TTL_MS = 5_000;
const MAX_DEDUP_ENTRIES = 500;

const recent = new Map();

function prune(now) {
  for (const [key, expiresAt] of recent) {
    if (expiresAt <= now) recent.delete(key);
  }
  if (recent.size <= MAX_DEDUP_ENTRIES) return;
  const overflow = recent.size - MAX_DEDUP_ENTRIES;
  let index = 0;
  for (const key of recent.keys()) {
    if (index >= overflow) break;
    recent.delete(key);
    index += 1;
  }
}

function scalar(value) {
  return value === undefined ? undefined : value;
}

function emitOnce(type, data) {
  const provider = scalar(data.provider);
  const connectionId = scalar(data.connectionId);
  const fingerprint = `${type}|${provider ?? ""}|${connectionId ?? ""}`;

  try {
    const now = Date.now();
    prune(now);
    if (recent.has(fingerprint)) {
      return { ok: true, emitted: false, reason: "duplicate" };
    }

    const result = emitWebhookEvent(type, {
      provider,
      model: scalar(data.model),
      connectionId,
      statusCode: scalar(data.statusCode),
      errorClass: scalar(data.errorClass),
    });

    if (result?.emitted) recent.set(fingerprint, now + DEDUP_TTL_MS);
    return result;
  } catch {
    return { ok: false, emitted: false, reason: "emit_error" };
  }
}

export function emitAccountUnavailable(data = {}) {
  return emitOnce("account.unavailable", data);
}

export function emitTokenRefreshFailed(data = {}) {
  return emitOnce("token.refresh_failed", {
    ...data,
    errorClass: data.errorClass || "refresh_failed",
  });
}

export function resetTransientWebhookDedup() {
  recent.clear();
}
