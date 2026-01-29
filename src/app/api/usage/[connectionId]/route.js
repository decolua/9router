import { getProviderConnectionById } from "@/lib/localDb";
import { getUsageForProvider } from "open-sse/services/usage.js";

/**
 * GET /api/usage/[connectionId] - Get usage data for a specific connection
 */
export async function GET(request, { params }) {
  try {
    const { connectionId } = await params;

    // Get connection from database
    const connection = await getProviderConnectionById(connectionId);
    if (!connection) {
      return Response.json({ error: "Connection not found" }, { status: 404 });
    }

    // Only OAuth connections have usage APIs
    if (connection.authType !== "oauth") {
      return Response.json({ message: "Usage not available for API key connections" });
    }

    // Fetch usage from provider API
    const usage = await getUsageForProvider(connection);
    return Response.json(usage);
  } catch (error) {
    console.log("Error fetching usage:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}
