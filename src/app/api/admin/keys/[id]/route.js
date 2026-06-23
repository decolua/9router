import { NextResponse } from "next/server";
import { requireAdminApiKey } from "@/lib/auth/adminApiKey";
import { deleteApiKey, getApiKeyById, updateApiKey } from "@/lib/localDb";
import { normalizePlanMonths } from "../../../../../lib/api-keys/plans.js";

const ALLOWED_PATCH_FIELDS = new Set(["name", "isActive", "planMonths"]);
const PATCH_NAME_ERROR = "Name is required";
const PATCH_NAME_LENGTH_ERROR = "Name must be 120 characters or fewer";

async function authorize(request) {
  try {
    if (await requireAdminApiKey(request)) return null;
  } catch {
    // Fail closed if the admin key check throws or rejects.
  }
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function buildPatch(body) {
  const source = body && typeof body === "object" ? body : {};
  const patch = {};

  for (const field of Object.keys(source)) {
    if (!ALLOWED_PATCH_FIELDS.has(field)) {
      throw new Error(`Unsupported field: ${field}`);
    }
  }

  if (Object.prototype.hasOwnProperty.call(source, "name")) {
    if (typeof source.name !== "string") throw new Error(PATCH_NAME_ERROR);
    const name = source.name.trim();
    if (!name) throw new Error(PATCH_NAME_ERROR);
    if (name.length > 120) throw new Error(PATCH_NAME_LENGTH_ERROR);
    patch.name = name;
  }

  if (Object.prototype.hasOwnProperty.call(source, "isActive")) {
    patch.isActive = source.isActive;
  }

  if (Object.prototype.hasOwnProperty.call(source, "planMonths")) {
    patch.planMonths = normalizePlanMonths(source.planMonths);
  }

  return patch;
}

function invalidPatchResponse(error) {
  return NextResponse.json({ error: error?.message || "Invalid key update" }, { status: 400 });
}

function isPatchValidationError(error) {
  if (error instanceof SyntaxError) return true;
  const message = error?.message || "";
  return (
    message === PATCH_NAME_ERROR ||
    message === PATCH_NAME_LENGTH_ERROR ||
    message.startsWith("Unsupported field:") ||
    message.startsWith("Plan must be one of") ||
    message.startsWith("isActive must be")
  );
}

export async function GET(request, { params }) {
  const unauthorized = await authorize(request);
  if (unauthorized) return unauthorized;

  try {
    const { id } = await params;
    const key = await getApiKeyById(id);
    if (!key) return NextResponse.json({ error: "Key not found" }, { status: 404 });
    return NextResponse.json({ key });
  } catch {
    return NextResponse.json({ error: "Failed to fetch key" }, { status: 500 });
  }
}

export async function PATCH(request, { params }) {
  const unauthorized = await authorize(request);
  if (unauthorized) return unauthorized;

  try {
    const { id } = await params;
    const body = await request.json();
    const key = await updateApiKey(id, buildPatch(body));
    if (!key) return NextResponse.json({ error: "Key not found" }, { status: 404 });
    return NextResponse.json({ key });
  } catch (error) {
    if (isPatchValidationError(error)) return invalidPatchResponse(error);
    return NextResponse.json({ error: "Failed to update key" }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  const unauthorized = await authorize(request);
  if (unauthorized) return unauthorized;

  try {
    const { id } = await params;
    const deleted = await deleteApiKey(id);
    if (!deleted) return NextResponse.json({ error: "Key not found" }, { status: 404 });
    return NextResponse.json({ message: "Key deleted successfully" });
  } catch {
    return NextResponse.json({ error: "Failed to delete key" }, { status: 500 });
  }
}
