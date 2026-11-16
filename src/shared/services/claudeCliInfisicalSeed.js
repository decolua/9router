import { createProviderConnection, getProviderConnections, updateProviderConnection } from "@/models";

const g = (global.__claudeCliInfisicalSeed ??= { ran: false });

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
      await updateProviderConnection(match.id, {
        providerSpecificData,
        testStatus: "active",
        isActive: true,
      });
      console.log(`[claude-cli] refreshed env credential (${name})`);
      g.result = "refreshed";
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
