import { getConsistentMachineId } from "@/shared/utils/machineId";

// Canonical CLI auth contract (matches cli/src/cli/api/client.js and
// src/dashboardGuard.js): the CLI authenticates to server routes with the
// `x-9r-cli-token` header, a machine-derived value, and talks to the server
// at NEXT_PUBLIC_BASE_URL / BASE_URL.
const CLI_TOKEN_HEADER = "x-9r-cli-token";
const CLI_TOKEN_SALT = "9r-cli-auth";

let cachedCliToken = null;

/**
 * Resolve the machine-derived CLI auth token (cached). Mirrors
 * dashboardGuard.getCliToken() so server routes and the CLI compute the same value.
 * @returns {Promise<string>}
 */
export async function getCliToken() {
  if (cachedCliToken === null) {
    cachedCliToken = await getConsistentMachineId(CLI_TOKEN_SALT);
  }
  return cachedCliToken;
}

export { CLI_TOKEN_HEADER };

/**
 * Resolve the 9router server base URL the CLI should talk to.
 * @returns {string}
 */
export function getServerBaseUrl() {
  return (
    process.env.NEXT_PUBLIC_BASE_URL ||
    process.env.BASE_URL ||
    "http://localhost:20128"
  );
}

/**
 * Resolve server credentials for CLI services (Codex/Claude/Gemini/...)
 * that persist tokens to the server. Returns the base URL, the machine-derived
 * CLI token (sent as `Authorization: Bearer <token>` + `X-User-Id`), and the
 * userId (machine id).
 *
 * This replaces the previously-broken import target
 * (`src/lib/oauth/config/index.js`, which never existed), closing the CLI
 * "added via TI, success shown, didn't appear" gap (issue #796).
 *
 * @returns {Promise<{ server: string, token: string, userId: string }>}
 */
export async function getServerCredentials() {
  const token = await getCliToken();
  return {
    server: getServerBaseUrl(),
    token,
    userId: token,
  };
}
