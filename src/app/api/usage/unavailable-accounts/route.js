import { getProviderConnections } from "@/lib/localDb";

const PROVIDER = "codex";
const DEFAULT_STATUS = 401;

/**
 * GET /api/usage/unavailable-accounts
 *
 * Returns accounts whose persisted routing state has the requested HTTP status.
 * This endpoint never probes upstream, so it remains fast for thousands of
 * accounts. Codex chat quota/auth guards keep this state up to date.
 *
 * Query params:
 *   status=401
 *   includeInactive=1
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const requestedStatus = Number.parseInt(
      searchParams.get("status") || String(DEFAULT_STATUS),
      10,
    );
    const includeInactive = searchParams.get("includeInactive") === "1";

    if (!Number.isInteger(requestedStatus) || requestedStatus < 100 || requestedStatus > 599) {
      return Response.json({ error: "status must be a valid HTTP status code" }, { status: 400 });
    }

    const connections = await getProviderConnections({ provider: PROVIDER });
    const emails = [...new Set(connections
      .filter((connection) => (
        (includeInactive || (connection.isActive ?? true))
        && connection.testStatus === "unavailable"
        && Number(connection.errorCode) === requestedStatus
        && connection.email
      ))
      .map((connection) => connection.email))];

    if (emails.length === 0) {
      return Response.json(
        { error: "No matching Codex accounts found" },
        { status: 404 },
      );
    }

    return Response.json(emails);
  } catch (error) {
    console.warn(`[Unavailable accounts API] ${error.message}`);
    return Response.json({ error: "Failed to check unavailable accounts" }, { status: 500 });
  }
}
