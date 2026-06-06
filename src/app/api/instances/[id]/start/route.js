import { NextResponse } from "next/server";
import { getInstanceById } from "@/lib/localDb";

// POST /api/instances/[id]/start
export async function POST(_req, { params }) {
  try {
    const { id } = await params;
    const instance = await getInstanceById(id);
    if (!instance) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const { startInstance } = require("@/lib/instances/manager");
    const result = startInstance(instance);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ success: true, port: instance.port });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
