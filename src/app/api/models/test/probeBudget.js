/**
 * Probe budgets per provider, shared by the model ping route and its test.
 *
 * Kept in its own dependency-free module because src/app/api/models/test is
 * imported through @/ path aliases that the vitest environment cannot
 * resolve - importing ping.js directly from a unit test fails before the
 * first assertion runs.
 */

import { resolveProviderId } from "@/shared/constants/providers.js";

/**
 * Providers whose "API" is a browser web endpoint behind a sign-in cookie.
 * A warmed-up probe costs 13-50s on these (per-account queueing plus an 800KB
 * session-page fetch), so the snappy REST budget below would turn every one
 * of their models into "The operation was aborted due to timeout".
 */
export const WEB_COOKIE_PROVIDERS = new Set(["gemini-web", "deepseek-web"]);

/**
 * Free-tier providers whose probe rides the normal chat fallback chain.
 * The opencode free tier answers 429 FreeUsageLimitError per spent session/IP
 * and the fallback rotates the session plus every proxy in turn (see the
 * session-rotation fix, upstream #5107), so a healthy model routinely needs
 * 30-90s before one window answers. The 15s REST budget below would abort the
 * probe mid-rotation and paint a working model red with
 * "The operation was aborted due to timeout".
 */
export const SLOW_FALLBACK_PROVIDERS = new Set(["opencode", "opencode-go", "opencode-zen"]);

/** Default per-probe budget for ordinary REST providers (fail fast). */
export const PROBE_TIMEOUT_MS = 15000;

/** Per-probe budget for cookie-based web providers. */
export const WEB_COOKIE_PROBE_TIMEOUT_MS = 90000;

/** Per-probe budget for slow-fallback free-tier providers. */
export const SLOW_FALLBACK_PROBE_TIMEOUT_MS = 120000;

/**
 * Probe budget for one model id of the form "<provider>/<model>".
 * The provider may be an alias ("oc/beam-free"), so resolve it to the
 * registry id first - an unresolved alias would fall through to the 15s REST
 * budget and abort a healthy slow-fallback probe mid-rotation.
 */
export function probeTimeoutMs(model) {
  const raw = String(model).split("/")[0];
  let provider = raw;
  try {
    provider = resolveProviderId(raw) || raw;
  } catch {
    provider = raw;
  }
  if (WEB_COOKIE_PROVIDERS.has(provider)) return WEB_COOKIE_PROBE_TIMEOUT_MS;
  if (SLOW_FALLBACK_PROVIDERS.has(provider)) return SLOW_FALLBACK_PROBE_TIMEOUT_MS;
  return PROBE_TIMEOUT_MS;
}
