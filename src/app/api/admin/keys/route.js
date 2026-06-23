import { NextResponse } from "next/server";
import { requireAdminApiKey } from "@/lib/auth/adminApiKey";
import { createApiKey, getApiKeys } from "@/lib/localDb";
import { normalizePlanMonths } from "../../../../lib/api-keys/plans.js";
import { getConsistentMachineId } from "@/shared/utils/machineId";

export const dynamic = "force-dynamic";

const CREATE_ERROR = "Name and valid planMonths are required";

async function authorize(request) {
  if (await requireAdminApiKey(request)) return null;
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function parseCreateBody(body) {
  const name = String(body?.name || "").trim();
  if (!name) throw new Error(CREATE_ERROR);
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
