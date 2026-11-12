/**
 * Shared dashboard key/credential feedback helpers (DF-9ROUTER-41).
 *
 * Pure, framework-free async flows extracted from the dashboard components so
 * the exact fetch contracts the UI relies on can be unit-tested without a DOM
 * (tests/ has no jsdom/RTL — same rationale as src/lib/federation/statusView.js).
 *
 * Components wire these into their React state; the mechanisms (validate
 * result shape, single-flight create guard) live here and are tested in
 * tests/unit/apikey-modal-feedback.test.js.
 */

/**
 * Run a credential check against POST /api/providers/validate and map the
 * response to a renderable result state.
 *
 * Response contract (src/app/api/providers/validate/route.js):
 *   200 { valid: true, error: null }
 *   200 { valid: false, error: "Invalid API key" | <provider-specific message> }
 *   4xx/5xx { error: "..." }
 * Network failures reject — both surface as { status: "invalid", message }.
 *
 * @param {object} opts
 * @param {string} opts.provider                 provider id (e.g. "openai")
 * @param {string} [opts.apiKey]                 credential value (not required for ollama-local)
 * @param {object} [opts.providerSpecificData]   region/azure/ollama host payload
 * @param {Function} [opts.fetchImpl]            fetch implementation (injectable for tests)
 * @returns {Promise<{status: "valid"|"invalid", message: string}>}
 */
export async function runKeyCheck({ provider, apiKey, providerSpecificData, fetchImpl = fetch } = {}) {
  try {
    const res = await fetchImpl("/api/providers/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, apiKey, providerSpecificData }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.valid) return { status: "valid", message: "Valid" };
    return { status: "invalid", message: data.error || "Invalid API key" };
  } catch (e) {
    return { status: "invalid", message: e?.message || "Check failed" };
  }
}

/**
 * Submit a create-key request (POST /api/keys) under a single-flight guard.
 *
 * The guard is a mutable ref-like object ({ current: boolean }) supplied by the
 * caller — in the dashboard components it is a React useRef, mirroring the
 * requireApiKeyInFlight pattern in EndpointPageClient. Re-entry while a submit
 * is pending is ignored (returns without a network call); the guard is reset in
 * finally so a completed or failed submit never wedges the button.
 *
 * @param {object} opts
 * @param {{current: boolean}} [opts.guard]      single-flight guard
 * @param {string} opts.name                     key name
 * @param {Function} [opts.fetchImpl]            fetch implementation (injectable for tests)
 * @param {Function} [opts.onCreated]            called with the parsed 200 body (data.key)
 * @param {Function} [opts.onError]              called with a human-readable failure message
 * @returns {Promise<{ok: boolean, skipped?: boolean, message?: string}>}
 */
export async function submitCreateKey({ guard, name, fetchImpl = fetch, onCreated, onError } = {}) {
  if (!name || !name.trim()) return { ok: false, skipped: true };
  if (guard && guard.current) return { ok: false, skipped: true };
  if (guard) guard.current = true;
  try {
    const res = await fetchImpl("/api/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      await onCreated?.(data);
      return { ok: true };
    }
    const message = data.error || `Failed to create key (${res.status})`;
    onError?.(message);
    return { ok: false, message };
  } catch (e) {
    const message = e?.message || "Failed to create key";
    onError?.(message);
    return { ok: false, message };
  } finally {
    if (guard) guard.current = false;
  }
}
