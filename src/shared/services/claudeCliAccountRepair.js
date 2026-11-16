/**
 * Repairs Claude Code CLI accounts that an earlier "Check" switched off.
 *
 * That Check decided signed-in state by looking for a credentials file. A token
 * account carries its credential in CLAUDE_CODE_OAUTH_TOKEN and has no such
 * file, so Check declared it signed out and wrote isActive:false /
 * testStatus:"pending" — disabling the only kind of account that works in a
 * container, and telling its owner to finish /login in a terminal that does not
 * exist there.
 *
 * Lives here rather than in the accounts route so that both callers — the route
 * (on GET) and initializeApp (at boot) — import a plain module. Boot used to
 * import the route itself, which pulled `next/server` and a Next route export
 * into the startup path for no reason.
 */
import fs from "fs/promises";
import path from "path";
import { getProviderConnections, updateProviderConnection } from "@/models";

export const CLAUDE_CLI_PROVIDER = "claude-cli";
const CREDENTIALS_FILE = ".credentials.json";

// One repair per server process, shared by every caller. Survives Next's module
// re-evaluation the same way the rest of the codebase does.
const g = (global.__claudeCliRepair ??= { once: null });

/** Claude Code writes this once a login completes. */
export async function credentialsFileExists(configDir) {
  if (!configDir) return false;
  try {
    const stat = await fs.stat(path.join(configDir, CREDENTIALS_FILE));
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

/**
 * Whether an account can authenticate, by the only two means there are.
 *
 * A token account carries its own credential, so there is no directory to
 * inspect — having the token IS being signed in. Only a config-directory
 * account has a credentials file to look for.
 *
 * One definition on purpose: it previously existed twice, and the copy behind
 * "Check" knew only about the file.
 */
export async function accountSignedIn(psd = {}) {
  if (psd?.oauthToken) return true;
  return credentialsFileExists(psd?.configDir || "");
}

/**
 * The OAuth access token this account can query its subscription quota with.
 *
 * Two sources, because there are two kinds of account. A token account carries
 * the credential itself (`claude setup-token`, long-lived). A config-directory
 * account has whatever Claude Code last wrote to its credentials file, which
 * the CLI refreshes as it runs.
 *
 * An expired file token is reported as no token rather than handed on: the
 * usage endpoint would reject it, and the caller would spend two further
 * legacy requests finding that out.
 *
 * The return value is a live credential for the user's Claude subscription —
 * it must never reach a log line or a response body.
 */
export async function claudeCliAccessToken(psd = {}) {
  if (psd?.oauthToken) return psd.oauthToken;
  if (!psd?.configDir) return null;
  try {
    const raw = await fs.readFile(path.join(psd.configDir, CREDENTIALS_FILE), "utf8");
    const oauth = JSON.parse(raw)?.claudeAiOauth;
    if (!oauth?.accessToken) return null;
    const expiresAt = Number(oauth.expiresAt);
    if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) return null;
    return oauth.accessToken;
  } catch {
    return null;
  }
}

/**
 * Re-enable accounts carrying the fingerprint the old Check left behind.
 *
 * Deliberately narrow: an account switched off on purpose keeps a different
 * testStatus, so it is left alone. Returns true when anything was changed.
 *
 * @param {Array<object>} [connections] pre-read rows, to avoid a second query
 */
async function runRepair(connections) {
  const rows = connections
    || await getProviderConnections({ provider: CLAUDE_CLI_PROVIDER });

  const repaired = [];
  for (const connection of rows) {
    if (connection.isActive !== false) continue;
    if (connection.testStatus !== "pending") continue;
    if (!await accountSignedIn(connection.providerSpecificData)) continue;
    await updateProviderConnection(connection.id, {
      isActive: true,
      testStatus: "active",
      existingProviderSpecificData: connection.providerSpecificData,
    });
    repaired.push(connection.id);
  }

  if (repaired.length) {
    console.log(`[claude-cli] re-enabled ${repaired.length} account(s) disabled by the old check`);
  }
  return repaired.length > 0;
}

export async function repairClaudeCliAccounts(connections) {
  try {
    return await runRepair(connections);
  } catch (e) {
    // Never block a boot or a page load over this.
    console.log(`[claude-cli] account repair skipped: ${e.message}`);
    return false;
  }
}

/**
 * The repair, at most once per server process.
 *
 * Exists because the boot path is not early enough on its own: initializeApp is
 * triggered by the root layout's import and then defers its heavy work by a few
 * seconds, while the Providers list fetches /api/providers immediately — so the
 * first load after a restart would still read a stale row and show
 * "No connections", correcting only on a later refresh. Awaiting this on that
 * route makes the first load right, and every later request returns the settled
 * promise without touching the database.
 */
export function repairClaudeCliAccountsOnce() {
  // A genuine failure is not cached: `false` here is ambiguous (it is also the
  // ordinary "nothing needed repairing" answer), so caching a database hiccup
  // would silently disable the repair for the life of the process.
  g.once ??= runRepair().catch((e) => {
    g.once = null;
    console.log(`[claude-cli] account repair skipped, will retry: ${e.message}`);
    return false;
  });
  return g.once;
}
