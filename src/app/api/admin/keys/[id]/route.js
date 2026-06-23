import { NextResponse } from "next/server";
import { requireAdminApiKey } from "@/lib/auth/adminApiKey";
import { deleteApiKey, getApiKeyById, updateApiKey } from "@/lib/localDb";
import { normalizePlanMonths } from "../../../../../lib/api-keys/plans.js";

const ALLOWED_PATCH_FIELDS = new Set(["name", "isActive", "planMonths"]);

async function authorize(request) {
  if (await requireAdminApiKey(request)) return null;
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
    const name = String(source.name || "").trim();
    if (!name) throw new Error("Name is required");
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
    message === "Name is required" ||
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
