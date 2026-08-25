import { verifyDashboardAuthToken } from "@/lib/auth/dashboardSession";
import { getConsistentMachineId } from "@/shared/utils/machineId";

const CLI_TOKEN_HEADER = "x-9r-cli-token";
const CLI_TOKEN_SALT = "9r-cli-auth";

let cachedCliToken = null;

async function getCliToken() {
  if (!cachedCliToken) cachedCliToken = await getConsistentMachineId(CLI_TOKEN_SALT);
  return cachedCliToken;
}

export async function hasDashboardOrCliAuth(request) {
  const cliToken = request.headers.get(CLI_TOKEN_HEADER);
  if (cliToken && cliToken === await getCliToken()) return true;

  const dashboardToken = request.cookies.get("auth_token")?.value;
  return await verifyDashboardAuthToken(dashboardToken);
}

export function unauthorizedResponse(message = "Dashboard or CLI authentication required") {
  return Response.json({ error: "unauthorized", message }, { status: 401 });
}
