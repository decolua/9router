"use server";

import { NextResponse } from "next/server";
import {
  getMitmStatus,
  startServer,
  stopServer,
  enableToolDNS,
  disableToolDNS,
  getCachedPassword,
  setCachedPassword,
  loadEncryptedPassword,
  initDbHooks,
} from "@/mitm/manager";
import { getSettings, updateSettings } from "@/lib/localDb";

initDbHooks(getSettings, updateSettings);

const isWin = process.platform === "win32";

function getPassword(provided) {
  return provided || getCachedPassword() || null;
}

// GET - Full MITM status (server + per-tool DNS)
export async function GET() {
  try {
    const status = await getMitmStatus();
    return NextResponse.json({
      running: status.running,
      pid: status.pid || null,
      certExists: status.certExists || false,
      dnsStatus: status.dnsStatus || {},
      hasCachedPassword: !!getCachedPassword(),
    });
  } catch (error) {
    console.log("Error getting MITM status:", error.message);
    return NextResponse.json({ error: "Failed to get MITM status" }, { status: 500 });
  }
}

// POST - Start MITM server (cert + server, no DNS)
export async function POST(request) {
  try {
    const { apiKey, sudoPassword } = await request.json();
    const pwd = getPassword(sudoPassword) || await loadEncryptedPassword() || "";

    if (!apiKey || (!isWin && !pwd)) {
      return NextResponse.json(
        { error: isWin ? "Missing apiKey" : "Missing apiKey or sudoPassword" },
        { status: 400 }
      );
    }

    const result = await startServer(apiKey, pwd);
    if (!isWin) setCachedPassword(pwd);

    return NextResponse.json({ success: true, running: result.running, pid: result.pid });
  } catch (error) {
    console.log("Error starting MITM server:", error.message);
    return NextResponse.json({ error: error.message || "Failed to start MITM server" }, { status: 500 });
  }
}

// DELETE - Stop MITM server (removes all DNS first, then kills server)
export async function DELETE(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { sudoPassword } = body;
    const pwd = getPassword(sudoPassword) || await loadEncryptedPassword() || "";

    if (!isWin && !pwd) {
      return NextResponse.json({ error: "Missing sudoPassword" }, { status: 400 });
    }

    await stopServer(pwd);
    if (!isWin && sudoPassword) setCachedPassword(sudoPassword);

    return NextResponse.json({ success: true, running: false });
  } catch (error) {
    console.log("Error stopping MITM server:", error.message);
    return NextResponse.json({ error: error.message || "Failed to stop MITM server" }, { status: 500 });
  }
}

// PATCH - Toggle DNS for a specific tool (enable/disable)
export async function PATCH(request) {
  try {
    const { tool, action, sudoPassword } = await request.json();
    const pwd = getPassword(sudoPassword) || await loadEncryptedPassword() || "";

    if (!tool || !action) {
      return NextResponse.json({ error: "tool and action required" }, { status: 400 });
    }
    if (!isWin && !pwd) {
      return NextResponse.json({ error: "Missing sudoPassword" }, { status: 400 });
    }

    if (action === "enable") {
      await enableToolDNS(tool, pwd);
    } else if (action === "disable") {
      await disableToolDNS(tool, pwd);
    } else {
      return NextResponse.json({ error: "action must be enable or disable" }, { status: 400 });
    }

    if (!isWin && sudoPassword) setCachedPassword(sudoPassword);

    const status = await getMitmStatus();
    return NextResponse.json({ success: true, dnsStatus: status.dnsStatus });
  } catch (error) {
    console.log("Error toggling DNS:", error.message);
    return NextResponse.json({ error: error.message || "Failed to toggle DNS" }, { status: 500 });
  }
}
