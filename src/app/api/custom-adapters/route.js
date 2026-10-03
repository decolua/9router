import { NextResponse } from "next/server";
import { getCustomAdapters, createCustomAdapter } from "@/models";

export const dynamic = "force-dynamic";

// GET /api/custom-adapters - List all custom adapters
export async function GET() {
  try {
    const adapters = await getCustomAdapters();
    return NextResponse.json({ adapters });
  } catch (error) {
    console.error("Error fetching custom adapters:", error);
    return NextResponse.json({ error: "Failed to fetch custom adapters" }, { status: 500 });
  }
}

// POST /api/custom-adapters - Create a new custom adapter
export async function POST(request) {
  try {
    const body = await request.json();
    const { name, prefix, baseUrl } = body;

    if (!name?.trim()) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    if (!prefix?.trim()) {
      return NextResponse.json({ error: "Prefix is required" }, { status: 400 });
    }

    if (!baseUrl?.trim()) {
      return NextResponse.json({ error: "Base URL is required" }, { status: 400 });
    }

    const adapter = await createCustomAdapter({
      ...body,
      name: name.trim(),
      prefix: prefix.trim().toLowerCase(),
      baseUrl: baseUrl.trim(),
    });

    return NextResponse.json({ adapter }, { status: 201 });
  } catch (error) {
    console.error("Error creating custom adapter:", error);
    return NextResponse.json({ error: error.message || "Failed to create custom adapter" }, { status: 500 });
  }
}
