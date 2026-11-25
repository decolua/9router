import { createHash } from "crypto";
import { createProviderConnection, getProviderConnections, updateProviderConnection } from "@/models";
import { getAdapter } from "@/lib/db/driver.js";

const g = (global.__claudeCliInfisicalSeed ??= { ran: false });

const SCOPE = "claudeCliSeed";

// Hash, not the value: the kv table is not a place for a live credential.
const dismissKey = (value) => createHash("sha256").update(String(value)).digest("hex");

/** The env credentials this seed would (re)create the given connection from. */
function seededKeys(psd = {}, env = process.env) {
  const keys = [];
  if (psd.oauthToken && psd.oauthToken === env.CLAUDE_CLI_OAUTH_TOKEN) keys.push(psd.oauthToken);
  if (psd.configDir && psd.configDir === env.CLAUDE_CLI_CONFIG_DIR) keys.push(psd.configDir);
  return keys;
}

/**
 * Remember that a connection the seed would recreate was deleted on purpose,
 * so the next boot does not bring it back. A different secret has a different
 * hash and seeds normally.
 */
export async function dismissSeededCredential(connection) {
  const keys = seededKeys(connection?.providerSpecificData);
  if (!keys.length) return;
  const db = await getAdapter();
  for (const key of keys) {
    db.run(
      `INSERT INTO kv(scope, key, value) VALUES(?, ?, '1') ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`,
      [SCOPE, dismissKey(key)],
    );
  }
}

async function isDismissed(keys) {
  const db = await getAdapter();
  return keys.some((key) => db.get(`SELECT 1 AS hit FROM kv WHERE scope = ? AND key = ?`, [SCOPE, dismissKey(key)]));
}

/**
 * Seed a claude-cli provider connection from a credential supplied via
 * environment, so the stored token can live in a secret manager rather than
 * in the dashboard. The connection row remains the source of truth for the
 * routed path; this only creates or refreshes the row on boot.
 *
 * Triggers:
 *   CLAUDE_CLI_OAUTH_TOKEN
 *   CLAUDE_CLI_CONFIG_DIR
 *
 * Matching:
 *   CLAUDE_CLI_OAUTH_TOKEN — same providerSpecificData.oauthToken wins
 *   CLAUDE_CLI_CONFIG_DIR  — same providerSpecificData.configDir wins
 *   otherwise a new connection is created (idempotent per process)
 *
 * A match is only refreshed (credential merged in); its name, active flag and
 * other settings belong to the operator. A credential whose connection was
 * deleted from the dashboard is not created again — see dismissSeededCredential.
 */
export async function seedClaudeCliFromEnv() {
  if (g.ran) return g.result;
  g.ran = true;

  const token = process.env.CLAUDE_CLI_OAUTH_TOKEN;
  const configDir = process.env.CLAUDE_CLI_CONFIG_DIR;
  if (!token && !configDir) {
    g.result = "skipped";
    return g.result;
  }

  const name = process.env.CLAUDE_CLI_ACCOUNT_NAME || "Infisical credential";
  const providerSpecificData = {};
  if (token) providerSpecificData.oauthToken = token;
  if (configDir) providerSpecificData.configDir = configDir;

  try {
    const existing = await getProviderConnections({ provider: "claude-cli" });
    const match = existing.find((c) => {
      const psd = c.providerSpecificData || {};
      if (token && psd.oauthToken === token) return true;
      if (configDir && psd.configDir === configDir) return true;
      return false;
    });

    if (match) {
      // Merged: replacing the object dropped scheduleOnly and identity on every boot.
      await updateProviderConnection(match.id, {
        providerSpecificData: { ...(match.providerSpecificData || {}), ...providerSpecificData },
      });
      console.log(`[claude-cli] refreshed env credential (${match.name || name})`);
      g.result = "refreshed";
      return g.result;
    }

    if (await isDismissed([token, configDir].filter(Boolean))) {
      console.log(`[claude-cli] env credential (${name}) was deleted from the dashboard; not seeding it again`);
      g.result = "dismissed";
      return g.result;
    }

    await createProviderConnection({
      provider: "claude-cli",
      authType: "none",
      accessToken: "cli",
      name,
      displayName: name,
      providerSpecificData,
      testStatus: "active",
      isActive: true,
    });
    console.log(`[claude-cli] seeded env credential (${name})`);
    g.result = "created";
    return g.result;
  } catch (e) {
    console.log(`[claude-cli] env credential seed failed: ${e.message}`);
    g.result = "failed";
    g.ran = false;
    return g.result;
  }
}
