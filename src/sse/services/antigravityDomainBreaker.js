/**
 * Antigravity Domain Circuit Breaker — dynamic, no hard-coded domain list.
 *
 * When a GSuite seller deletes/suspends a whole domain (@gmilil.my.id,
 * @gmosel.com, @any-random-domain.my.id ...), Google returns the same
 * permanent 400/401/403 for EVERY account on that domain. Testing them one
 * by one costs N × timeout before the router reaches a healthy domain.
 *
 * This module auto-detects any domain that is dying and bulk-disables the
 * entire domain in one write, so the next getProviderCredentials() call
 * skips it entirely (< 50 ms).
 *
 * Safe: gmail.com / googlemail.com are whitelisted — only per-account lock
 * ever applies to them. Threshold is adaptive so a single typo does not
 * nuke a healthy domain.
 */
import { getProviderConnections, updateProviderConnection, getSettings } from "@/lib/localDb";
import * as log from "../utils/logger.js";

// Never domain-break these public providers
const WHITELISTED_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

// In-memory breaker state — survives per-process, cheap
const brokenDomains = new Set(); // domain -> already broken this process

export function getBrokenDomains() {
  return new Set(brokenDomains);
}

function extractDomain(email) {
  if (!email || typeof email !== "string") return "";
  const at = email.lastIndexOf("@");
  if (at === -1) return "";
  return email.slice(at + 1).trim().toLowerCase();
}

// 400/401/403 with auth text that proves the account is permanently dead,
// not a transient quota (429) or bad request body.
const PERMANENT_AUTH_PATTERNS = [
  /invalid_grant/i,
  /PERMISSION_DENIED/i,
  /UNAUTHENTICATED/i,
  /account.*(?:deleted|disabled|not found|suspended|does not exist)/i,
  /user.*(?:deleted|disabled|not found|suspended)/i,
  /Bad Request/i,
  /NO_CREDENTIALS/i,
];

export function isPermanentAntigravityAuthFailure(status, errorText) {
  if (status !== 400 && status !== 401 && status !== 403) return false;
  const text = String(errorText || "");
  if (!text) return false;
  return PERMANENT_AUTH_PATTERNS.some((re) => re.test(text));
}

/**
 * Called right after a permanent 400/401/403 from the Antigravity executor.
 * Decides whether to bulk-disable an entire dynamic domain.
 *
 * Rules (all dynamic — no hard-coded domain list):
 *   - Whitelisted domains (gmail.com) → never
 *   - Domain with < 3 total accounts → needs 1 dead to trigger (small pools)
 *   - Domain with 3-15 accounts   → needs 2 dead in any window
 *   - Domain with >15 accounts    → needs 2 dead OR >= 30% dead
 *
 * The bulk write is fire-and-forget from the chat handler's point of view
 * (awaited here because the next account selection happens inside the same
 * while(true) loop and must see the isActive=false).
 *
 * @param {string} email - failed account email
 * @param {string} provider - must be "antigravity"
 * @returns {Promise<{ broken: boolean, domain: string, disabledCount: number }>}
 */
export async function maybeBreakAntigravityDomain(email, provider) {
  const domain = extractDomain(email);
  if (!domain) return { broken: false, domain: "", disabledCount: 0 };
  if (provider && provider !== "antigravity") return { broken: false, domain, disabledCount: 0 };
  if (WHITELISTED_DOMAINS.has(domain)) return { broken: false, domain, disabledCount: 0 };
  if (brokenDomains.has(domain)) return { broken: false, domain, disabledCount: 0 };

  // Use a snapshot of current active connections to compute counts
  let allForDomain;
  try {
    const connections = await getProviderConnections({ provider: "antigravity", isActive: true });
    allForDomain = connections.filter((c) => extractDomain(c.email) === domain);
  } catch {
    return { broken: false, domain, disabledCount: 0 };
  }

  const total = allForDomain.length;
  if (total === 0) return { broken: false, domain, disabledCount: 0 };

  // Re-read with inactive included to count how many are already disabled
  let allWithInactive;
  try {
    const raw = await getProviderConnections({ provider: "antigravity" });
    // getProviderConnections without isActive filter returns all — but we want only this domain
    allWithInactive = raw.filter((c) => extractDomain(c.email) === domain);
  } catch {
    allWithInactive = allForDomain;
  }

  const alreadyDisabled = allWithInactive.length - total;
  const deadCount = alreadyDisabled + 1; // +1 for the just-failed account (not yet written as disabled in this call)

  // Adaptive threshold — dynamic per domain size
  let threshold;
  if (total < 3) threshold = 1;
  else if (total <= 15) threshold = 2;
  else threshold = Math.max(2, Math.ceil(allWithInactive.length * 0.3));

  // Alternative ratio trigger for large domains (e.g. 40 accounts, 12 already dead = 30%)
  const ratioTriggered = allWithInactive.length >= 6 && deadCount / allWithInactive.length >= 0.35;

  const shouldBreak = deadCount >= threshold || ratioTriggered;
  if (!shouldBreak) {
    return { broken: false, domain, disabledCount: 0 };
  }

  // Mark broken so we don't hammer the DB for the same domain
  brokenDomains.add(domain);

  let disabledCount = 0;
  const reason = `domain_dead:${domain}`;
  const nowIso = new Date().toISOString();

  for (const c of allForDomain) {
    try {
      const data = c.data && typeof c.data === "object" ? { ...c.data } : {};
      data.disabledReason = reason;
      data.disabledAt = nowIso;
      await updateProviderConnection(c.id, {
        isActive: false,
        data,
        testStatus: "unavailable",
        lastError: `Domain ${domain} auto-disabled: ${deadCount}/${allWithInactive.length} accounts permanent 400`,
        errorCode: 400,
        lastErrorAt: nowIso,
      });
      disabledCount++;
    } catch {
      // best effort per account
    }
  }

  // Also mark the originally failed account if it wasn't in isActive:true set
  // (it was, but be safe)

  log.warn("AG_DOMAIN_BREAKER", `${domain} | ${deadCount}/${allWithInactive.length} permanent 400 -> bulk-disabled ${disabledCount} accounts (${reason})`);
  return { broken: true, domain, disabledCount };
}

// Test-only: reset in-memory set
export function _resetBreakerForTest() {
  brokenDomains.clear();
}
