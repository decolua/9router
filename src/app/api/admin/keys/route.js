import { NextResponse } from "next/server";
import { requireAdminApiKey } from "@/lib/auth/adminApiKey";
import { createApiKey, getApiKeys } from "@/lib/localDb";
import { normalizePlanMonths } from "../../../../lib/api-keys/plans.js";
import { getConsistentMachineId } from "@/shared/utils/machineId";

export const dynamic = "force-dynamic";

const CREATE_ERROR = "Name and valid planMonths are required";
const MAX_NAME_LENGTH = 120;

async function authorize(request) {
  try {
    if (await requireAdminApiKey(request)) return null;
  } catch {
    // Fail closed if the admin key check throws or rejects.
  }
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function parseCreateBody(body) {
  if (typeof body?.name !== "string") throw new Error(CREATE_ERROR);
  const name = body.name.trim();
  if (!name || name.length > MAX_NAME_LENGTH) throw new Error(CREATE_ERROR);
  return { name, planMonths: normalizePlanMonths(body?.planMonths) };
}

export async function GET(request) {
  const unauthorized = await authorize(request);
  if (unauthorized) return unauthorized;

  try {
    const keys = await getApiKeys();
    return NextResponse.json({ keys });
  } catch {
    return NextResponse.json({ error: "Failed to fetch keys" }, { status: 500 });
  }
}

export async function POST(request) {
  const unauthorized = await authorize(request);
  if (unauthorized) return unauthorized;

  try {
    const body = await request.json();
    const { name, planMonths } = parseCreateBody(body);
    const machineId = await getConsistentMachineId();
    const key = await createApiKey(name, machineId, { planMonths });
    return NextResponse.json({ key }, { status: 201 });
  } catch (error) {
    if (error instanceof SyntaxError || error?.message === CREATE_ERROR || error?.message?.startsWith("Plan must be one of")) {
      return NextResponse.json({ error: CREATE_ERROR }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to create key" }, { status: 500 });
  }
}
