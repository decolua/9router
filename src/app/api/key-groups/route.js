import { NextResponse } from "next/server";
import { getKeyGroups, createKeyGroup } from "@/models";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const groups = await getKeyGroups();
    return NextResponse.json({ groups });
  } catch (error) {
    console.log("Error fetching key groups:", error);
    return NextResponse.json({ error: "Failed to fetch key groups" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { name, description, allowedConnectionIds } = body;
    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }
    const group = await createKeyGroup({
      name,
      description: description || "",
      allowedConnectionIds: allowedConnectionIds || [],
    });
    return NextResponse.json({ group }, { status: 201 });
  } catch (error) {
    console.log("Error creating key group:", error);
    return NextResponse.json({ error: "Failed to create key group" }, { status: 500 });
  }
}
