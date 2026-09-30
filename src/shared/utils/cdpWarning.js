// CDP exposure warning for the cookie-capture UI.
//
// While a browser runs with --remote-debugging-port, any local process can
// read its cookies for every site. Two signals drive the UI nudge:
//  - always: after a successful capture, remind the user to close the debug
//    browser (or restart it without the debug port);
//  - stale: when the debug browser has been up longer than STALE_AFTER_MS,
//    call that out explicitly so long-forgotten debug sessions get closed.

export const CDP_STALE_AFTER_MS = 10 * 60 * 1000;

/**
 * Build the post-capture CDP security warning for the capture buttons.
 *
 * @param {number|null} cdpUpSinceMs - first-seen epoch ms from the capture
 *   route (getCdpUpSince), or null when unknown.
 * @param {number} [nowMs] - injectable clock for tests.
 * @returns {{ stale: boolean, minutes: number|null, text: string }|null}
 *   null when cdpUpSinceMs is missing.
 */
export function buildCdpWarning(cdpUpSinceMs, nowMs = Date.now()) {
  if (typeof cdpUpSinceMs !== "number" || !Number.isFinite(cdpUpSinceMs) || cdpUpSinceMs <= 0) return null;
  const upMs = nowMs - cdpUpSinceMs;
  const stale = upMs >= CDP_STALE_AFTER_MS;
  const minutes = Math.max(0, Math.round(upMs / 60000));
  const staleLead = stale
    ? `Debug browser has been running for ${minutes} min. `
    : "";
  return {
    stale,
    minutes,
    text: `${staleLead}While it runs with the debug port, any local process can read its cookies — close it (or restart it without the debug port) when done capturing.`,
  };
}
