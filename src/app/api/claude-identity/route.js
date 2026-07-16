import { NextResponse } from "next/server";
import { getClaudeIdentityDebug } from "open-sse/utils/claudeIdentityManager.js";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getClaudeIdentityDebug());
}
