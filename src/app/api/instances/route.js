import { NextResponse } from "next/server";
import { getInstances, createInstance } from "@/lib/localDb";

// GET /api/instances — list all instances
export async function GET() {
  try {
    const instances = await getInstances();
    const { listRunning } = require("@/lib/instances/manager");
    const running = new Set(listRunning());
    const result = instances.map((inst) => ({
      ...inst,
      running: running.has(inst.id),
    }));
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/instances — create a new instance
export async function POST(request) {
  try {
    const body = await request.json();
    const { name, port, dataDir, autoStart } = body;

    if (!port || isNaN(Number(port))) {
      return NextResponse.json({ error: "port is required and must be a number" }, { status: 400 });
    }

    // Check port not already used by another instance
    const existing = await getInstances();
    if (existing.some((i) => Number(i.port) === Number(port))) {
      return NextResponse.json({ error: `Port ${port} is already used by another instance` }, { status: 409 });
    }

    const instance = await createInstance({ name, port: Number(port), dataDir, autoStart });
    return NextResponse.json(instance, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
