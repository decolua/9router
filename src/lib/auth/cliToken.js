import { getConsistentMachineId } from "@/shared/utils/machineId";

/**
 * The token the local CLI launcher presents to prove it is the local CLI.
 *
 * Derived from the machine, so it never has to be stored. Kept here rather than
 * inside the dashboard guard because routes need it too, and a route that
 * imports the guard drags the whole middleware graph into its own bundle.
 */
export const CLI_TOKEN_HEADER = "x-9r-cli-token";
const CLI_TOKEN_SALT = "9r-cli-auth";

let cachedCliToken = null;

export async function getCliToken() {
  if (!cachedCliToken) cachedCliToken = await getConsistentMachineId(CLI_TOKEN_SALT);
  return cachedCliToken;
}

/**
 * Whether this request really carries the CLI's token.
 *
 * Checked, not counted. `/api/settings/database` used to treat the header's
 * mere presence as proof and skip its password re-auth on it, so any logged-in
 * dashboard session could export the database — which carries every stored
 * provider credential — by sending a made-up value.
 */
export async function hasValidCliToken(request) {
  const token = request.headers.get(CLI_TOKEN_HEADER);
  if (!token) return false;
  return token === await getCliToken();
}
