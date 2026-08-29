import { NextResponse } from "next/server";
import { ZaiAuthFlow } from "@/lib/zcode/auth";
import { getZaiSession, deleteZaiSession } from "@/lib/zcode/sessions";
import { createProviderConnection } from "@/models";

/**
 * POST /api/oauth/zai/poll — poll Z.AI OAuth status; create connection when ready
 * Body: { flowId: string }
 */
export async function POST(request) {
  try {
    const { flowId } = await request.json();
    if (!flowId) {
      return NextResponse.json({ error: "flowId is required" }, { status: 400 });
    }

    const session = await getZaiSession(flowId);
    if (!session) {
      return NextResponse.json({ error: "OAuth session expired or not found" }, { status: 404 });
    }

    const flow = new ZaiAuthFlow(undefined, session.pollToken);
    const data = await flow.poll(flowId);

    if (data.status === "pending") {
      return NextResponse.json({ status: "pending" });
    }

    if (data.status === "failed") {
      await deleteZaiSession(flowId);
      return NextResponse.json({ status: "failed", error: "Authorization denied or failed" });
    }

    if (data.status !== "ready") {
      return NextResponse.json({ status: data.status || "unknown" });
    }

    const accessToken = data.zai?.access_token;
    const zcodeJwtToken = data.token;
    if (!accessToken) {
      return NextResponse.json({ error: "Access token missing from OAuth response" }, { status: 500 });
    }

    const tokenData = await flow.exchangeForConnection(accessToken, zcodeJwtToken, data);
    await deleteZaiSession(flowId);

    const connection = await createProviderConnection({
      provider: "glm",
      authType: "oauth",
      ...tokenData,
      testStatus: "active",
      isActive: true,
    });

    return NextResponse.json({
      status: "ready",
      connection: {
        id: connection.id,
        provider: connection.provider,
        email: connection.email,
        name: connection.name,
      },
    });
  } catch (error) {
    console.error("[Z.AI OAuth] poll error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}