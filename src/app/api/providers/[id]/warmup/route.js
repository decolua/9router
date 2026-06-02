import { NextResponse } from "next/server";
import { warmupSingleConnection } from "../test/testUtils.js";

// POST /api/providers/[id]/warmup - Warmup connection
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    let options = {};
    try {
      options = await request.json();
    } catch (e) {
      // Ignore if body is empty
    }
    const result = await warmupSingleConnection(id, options);

    if (result.error === "Connection not found") {
      return NextResponse.json(
        { error: "Connection not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({
      valid: result.valid,
      error: result.error,
    });
  } catch (error) {
    console.log("Error warming up connection:", error);
    return NextResponse.json({ error: "Warmup failed" }, { status: 500 });
  }
}
