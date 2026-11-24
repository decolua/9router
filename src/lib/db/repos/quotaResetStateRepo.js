import { makeKv } from "../helpers/kvStore.js";

/**
 * What the quota-reset notifier last saw for each account — which 5h / weekly
 * windows are open and when they end — so a restart resumes waiting for the
 * same resets instead of starting blind.
 *
 * Lives in the shared `kv` table under its own scope: it is runtime state, not
 * configuration, so it stays out of the settings blob (which is exported,
 * synced and returned to the dashboard).
 */
const kv = makeKv("quotaResetState");

/** @returns {Promise<Record<string, {windows: object, hasWindows: boolean}>>} */
export async function loadQuotaResetState() {
  return kv.getAll();
}

export async function saveQuotaResetAccount(connectionId, account) {
  await kv.set(connectionId, { windows: account.windows || {}, hasWindows: account.hasWindows === true });
}

export async function removeQuotaResetAccount(connectionId) {
  await kv.remove(connectionId);
}

export async function clearQuotaResetState() {
  await kv.clear();
}
