import { NextResponse } from "next/server";
import { ZaiAuthFlow } from "@/lib/zcode/auth";
import { createZaiSession } from "@/lib/zcode/sessions";

/**
 * POST /api/oauth/zai/init — start Z.AI CLI OAuth flow
 */
export async function POST() {
  try {
    const flow = new ZaiAuthFlow();
    const { flowId, authorizeUrl, pollToken } = await flow.init();
    await createZaiSession({ flowId, pollToken });

    return NextResponse.json({ flowId, authorizeUrl });
  } catch (error) {
    console.error("[Z.AI OAuth] init error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}