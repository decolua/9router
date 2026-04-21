"use server";

import { NextResponse } from "next/server";
import { startDaemonWithPassword } from "@/lib/tunnel/tailscale";
import * as mitmManager from "@/mitm/manager";

const { getCachedPassword, loadEncryptedPassword, initDbHooks } = mitmManager;
import { getSettings, updateSettings } from "@/lib/localDb";

initDbHooks(getSettings, updateSettings);

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    // Use provided password, or fall back to cached/stored MITM password
    const password = body.sudoPassword || getCachedPassword() || await loadEncryptedPassword() || "";
    await startDaemonWithPassword(password);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Tailscale start daemon error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
