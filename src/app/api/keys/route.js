import { NextResponse } from "next/server";
import { getApiKeys, createApiKey } from "@/lib/localDb";
import { getConsistentMachineId } from "@/shared/utils/machineId";
import { withAuthUser } from "@/lib/auth/runtimeUserContext.js";
import { auditFromRequest, AuditAction } from "@/lib/audit";

export const dynamic = "force-dynamic";

export const GET = withAuthUser(async (_request, _ctx, user) => {
  try {
    const keys = await getApiKeys(user.id);
    return NextResponse.json({ keys });
  } catch (error) {
    console.log("Error fetching keys:", error);
    return NextResponse.json({ error: "Failed to fetch keys" }, { status: 500 });
  }
});

export const POST = withAuthUser(async (request, _ctx, user) => {
  try {
    const body = await request.json();
    const { name } = body;

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    const machineId = await getConsistentMachineId();
    const apiKey = await createApiKey(name, machineId, user.id);

    await auditFromRequest(request, {
      action: AuditAction.API_KEY_CREATED,
      actorUserId: user.id,
      actorEmail: user.email,
      targetType: "api_key",
      targetId: apiKey.id,
      meta: { name: apiKey.name },
    });

    return NextResponse.json({
      key: apiKey.key,
      name: apiKey.name,
      id: apiKey.id,
      machineId: apiKey.machineId,
    }, { status: 201 });
  } catch (error) {
    console.log("Error creating key:", error);
    return NextResponse.json({ error: "Failed to create key" }, { status: 500 });
  }
});
