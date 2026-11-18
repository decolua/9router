import { NextResponse } from "next/server";
import { getKeyModelGroups, changeKeyModelGroup } from "@/lib/db/repos/keyModelGroupsRepo.js";
import { validateKeyAccessInput } from "@/shared/utils/keyAccess.js";

export const dynamic = "force-dynamic";

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_NAME_LENGTH = 100;

function badRequest(error) {
  return NextResponse.json({ error }, { status: 400 });
}

function validate(body, update) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "Body must be an object" };
  const fields = update ? ["id", "name", "allow"] : ["name", "allow"];
  if (Object.keys(body).some((key) => !fields.includes(key))) return { error: "Unexpected field in body" };
  if (update && (typeof body.id !== "string" || !ID_PATTERN.test(body.id))) return { error: "Invalid group id" };
  if (typeof body.name !== "string" || !body.name.trim() || body.name.length > MAX_NAME_LENGTH) {
    return { error: `Name must be between 1 and ${MAX_NAME_LENGTH} characters` };
  }
  if (!Array.isArray(body.allow)) return { error: "allow must be an array of strings" };
  if (body.allow.some((entry) => typeof entry === "string" && /^@group\//i.test(entry.trim()))) {
    return { error: "Group allow entries cannot reference another group" };
  }
  const access = validateKeyAccessInput({ restricted: true, allow: body.allow });
  if (!access.ok) return { error: access.error };
  return { value: { ...(update ? { id: body.id } : {}), name: body.name.trim(), allow: access.value.allow } };
}

export async function GET() {
  try {
    return NextResponse.json({ groups: await getKeyModelGroups() });
  } catch (error) {
    console.error("Error fetching key model groups:", error);
    return NextResponse.json({ error: "Failed to fetch groups" }, { status: 500 });
  }
}

async function save(request, update) {
  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid JSON body");
  }
  const validated = validate(body, update);
  if (validated.error) return badRequest(validated.error);
  try {
    const result = await changeKeyModelGroup(update ? "update" : "create", validated.value);
    if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result, { status: update ? 200 : 201 });
  } catch (error) {
    console.error("Error saving key model group:", error);
    return NextResponse.json({ error: "Failed to save group" }, { status: 500 });
  }
}

export async function POST(request) {
  return save(request, false);
}

export async function PUT(request) {
  return save(request, true);
}

export async function DELETE(request) {
  const params = new URL(request.url).searchParams;
  const ids = params.getAll("id");
  if (ids.length !== 1 || !ID_PATTERN.test(ids[0])) return badRequest("Invalid group id");
  try {
    const result = await changeKeyModelGroup("delete", { id: ids[0] });
    if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result);
  } catch (error) {
    console.error("Error deleting key model group:", error);
    return NextResponse.json({ error: "Failed to delete group" }, { status: 500 });
  }
}
