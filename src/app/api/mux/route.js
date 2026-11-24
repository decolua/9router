import { NextResponse } from "next/server";
import {
  loadMuxConfig,
  saveMuxConfig,
  isMuxRunning,
  startMux,
  stopMux,
  getStats,
  installStatus,
  installMux,
  cancelInstall,
  deleteMux,
} from "@/lib/muxManager.js";

// GET - Return status, config, and metrics
export async function GET() {
  try {
    const config = loadMuxConfig();
    const stats = getStats();
    
    return NextResponse.json({
      success: true,
      config,
      stats,
      installStatus,
    });
  } catch (error) {
    console.error("[MuxAPI] GET Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// POST - Start server, save config, or install/cancel/delete
export async function POST(request) {
  try {
    const body = await request.json();
    const { action, config } = body;

    if (action === "save_config" && config) {
      const saved = saveMuxConfig(config);
      return NextResponse.json({ success: saved });
    }

    if (action === "start") {
      const result = await startMux();
      return NextResponse.json(result);
    }

    if (action === "install") {
      const result = await installMux();
      return NextResponse.json(result);
    }

    if (action === "cancel_install") {
      const result = cancelInstall();
      return NextResponse.json({ success: result });
    }

    if (action === "delete_mux") {
      const result = deleteMux();
      return NextResponse.json(result);
    }

    return NextResponse.json({ success: false, error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("[MuxAPI] POST Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// DELETE - Stop server
export async function DELETE() {
  try {
    const success = stopMux();
    return NextResponse.json({ success });
  } catch (error) {
    console.error("[MuxAPI] DELETE Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
