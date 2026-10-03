import { getConsistentMachineId } from "@/shared/utils/machineId";

const CLI_TOKEN_HEADER = "x-9r-cli-token";
const CLI_TOKEN_SALT = "9r-cli-auth";

let cachedCliToken = null;

async function getCliToken() {
  cachedCliToken ||= await getConsistentMachineId(CLI_TOKEN_SALT);
  return cachedCliToken;
}

export async function hasValidCliToken(request) {
  const suppliedToken = request.headers.get(CLI_TOKEN_HEADER);
  if (!suppliedToken) return false;
  return suppliedToken === await getCliToken();
}
