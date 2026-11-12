import { NextResponse } from "next/server";
import { getProviderConnectionById } from "@/models";
import { requestDeviceAuthorization } from "@/lib/opendesignDeviceAuth";

/**
 * POST /api/opendesign/device
 * Body: { connectionId }
 *
 * Step 1 of the "get Control Key" button: asks OpenDesign's CLI device flow for
 * a user code the customer can approve in their browser.
 *
 * The response is intentionally key-free and secret-free — `deviceSecret` stays
 * in the server process (see src/lib/opendesignDeviceAuth.js), because handing
 * it to the browser would let anything running in the page replay the poll.
 *
 * WHY the connection is looked up first: the device authorization is bound to
 * one connection, and refusing an unknown id here keeps orphaned entries out of
 * the in-memory store.
 */
export async function POST(request) {
  let connectionId = null;
  try {
    const body = await request.json().catch(() => ({}));
    connectionId = typeof body?.connectionId === "string" ? body.connectionId.trim() : "";
    if (!connectionId) {
      return NextResponse.json({ error: "connectionId is required" }, { status: 400 });
    }

    const connection = await getProviderConnectionById(connectionId);
    if (!connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }
    if (connection.provider !== "opendesign-go") {
      return NextResponse.json(
        { error: `Connection is not opendesign-go (got ${connection.provider})` },
        { status: 400 },
      );
    }

    const result = await requestDeviceAuthorization({ connectionId });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status || 502 });
    }

    const { deviceId, userCode, activationUrl, expiresAt, intervalMs } = result.device;
    return NextResponse.json({ deviceId, userCode, activationUrl, expiresAt, intervalMs });
  } catch (error) {
    console.log("OpenDesign device authorization error:", error);
    const message = error?.message || "Failed to start OpenDesign device authorization";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
