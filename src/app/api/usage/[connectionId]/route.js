import { getProviderConnectionById } from "@/lib/localDb";
import { USAGE_APIKEY_PROVIDERS } from "@/shared/constants/providers";
import { isLeaseConnection } from "open-sse/services/minimaxCodeLease.js";
import { collectProviderUsage } from "@/shared/services/providerUsage";

// Kept for existing reset routes and auto-ping callers.
export { refreshAndUpdateCredentials } from "@/shared/services/providerUsage";

export async function GET(request, { params }) {
  let connection;
  try {
    const { connectionId } = await params;
    connection = await getProviderConnectionById(connectionId);
    if (!connection) return Response.json({ error: "Connection not found" }, { status: 404 });
    const eligible = connection.authType === "oauth"
      || (["apikey", "api_key"].includes(connection.authType) && USAGE_APIKEY_PROVIDERS.includes(connection.provider))
      || isLeaseConnection(connection);
    if (!eligible) return Response.json({ message: "Usage not available for this connection" });
    const force = new URL(request.url).searchParams.get("force") === "1";
    const usage = await collectProviderUsage(connection, { force });
    return Response.json(usage);
  } catch (error) {
    console.warn(`[Usage] ${connection?.provider ?? "unknown"}: ${error.message}`);
    return Response.json({ error: error.message }, { status: error.status || 500 });
  }
}
