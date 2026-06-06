import { NextResponse } from "next/server";

// POST /api/instances/[id]/stop
export async function POST(_req, { params }) {
  try {
    const { id } = await params;
    const { stopInstance } = require("@/lib/instances/manager");
    const result = stopInstance(id);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
