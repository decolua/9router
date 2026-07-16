import { NextResponse } from "next/server";
import { clearClaudeIdentity } from "open-sse/utils/claudeIdentityManager.js";

export const dynamic = "force-dynamic";

export async function POST() {
  clearClaudeIdentity();
  return NextResponse.json({ success: true });
}
