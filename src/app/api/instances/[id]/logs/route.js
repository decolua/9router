import { NextResponse } from "next/server";

// GET /api/instances/[id]/logs
export async function GET(_req, { params }) {
  try {
    const { id } = await params;
    const { getInstanceLogs } = require("@/lib/instances/manager");
    const logs = getInstanceLogs(id);
    return NextResponse.json({ logs });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
