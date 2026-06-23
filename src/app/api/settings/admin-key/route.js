import { NextResponse } from "next/server";
import {
  createOrRotateAdminApiKey,
  getAdminApiKeyStatus,
} from "@/lib/auth/adminApiKey";
import { AdminApiKeyRotationConflictError } from "@/lib/localDb";
import { verifyDashboardAuthToken } from "@/lib/auth/dashboardSession";
import { getConsistentMachineId } from "@/shared/utils/machineId";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const CLI_TOKEN_HEADER = "x-9r-cli-token";
const CLI_TOKEN_SALT = "9r-cli-auth";
const RESPONSE_HEADERS = {
  "Cache-Control": "no-store",
};

let cachedCliToken = null;

async function getCliToken() {
  if (!cachedCliToken) cachedCliToken = await getConsistentMachineId(CLI_TOKEN_SALT);
  return cachedCliToken;
}

async function isAuthorized(request) {
  const cookieToken = request.cookies.get("auth_token")?.value;
  if (await verifyDashboardAuthToken(cookieToken)) return true;

  const cliToken = request.headers.get(CLI_TOKEN_HEADER);
  if (!cliToken) return false;
  return cliToken === await getCliToken();
}

function unauthorizedResponse() {
  return NextResponse.json({ error: "Unauthorized" }, {
    status: 401,
    headers: RESPONSE_HEADERS,
  });
}

async function parseRotateRequest(request) {
  if (!request.headers.get("content-type")?.includes("application/json")) {
    throw new Error("MISSING_JSON_BODY");
  }

  let body;
  try {
    body = await request.json();
  } catch {
    throw new Error("INVALID_JSON");
  }
  const expectedUpdatedAt = body?.expectedUpdatedAt;

  if (expectedUpdatedAt === undefined) {
    throw new Error("MISSING_EXPECTED_UPDATED_AT");
  }
  if (typeof expectedUpdatedAt !== "string") {
    throw new Error("INVALID_EXPECTED_UPDATED_AT");
  }

  return { expectedUpdatedAt };
}

export async function GET(request) {
  if (!(await isAuthorized(request))) return unauthorizedResponse();

  try {
    const status = await getAdminApiKeyStatus();
    return NextResponse.json(status, { headers: RESPONSE_HEADERS });
  } catch (error) {
    console.error("Error loading admin API key status:", error);
    return NextResponse.json(
      { error: "Failed to load admin API key status" },
      { status: 500, headers: RESPONSE_HEADERS }
    );
  }
}

export async function POST(request) {
  if (!(await isAuthorized(request))) return unauthorizedResponse();

  try {
    const { expectedUpdatedAt } = await parseRotateRequest(request);
    const result = await createOrRotateAdminApiKey(new Date(), { expectedUpdatedAt });
    return NextResponse.json(result, {
      status: 201,
      headers: RESPONSE_HEADERS,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "MISSING_JSON_BODY") {
      return NextResponse.json(
        { error: "Request body must be JSON" },
        { status: 400, headers: RESPONSE_HEADERS }
      );
    }

    if (error instanceof Error && error.message === "INVALID_JSON") {
      return NextResponse.json(
        { error: "Request body must be valid JSON" },
        { status: 400, headers: RESPONSE_HEADERS }
      );
    }

    if (
      error instanceof Error &&
      (error.message === "INVALID_EXPECTED_UPDATED_AT" || error.message === "MISSING_EXPECTED_UPDATED_AT")
    ) {
      return NextResponse.json(
        { error: "expectedUpdatedAt must be a string" },
        { status: 400, headers: RESPONSE_HEADERS }
      );
    }

    if (error instanceof AdminApiKeyRotationConflictError) {
      return NextResponse.json(
        { error: "Admin API key changed. Reload status and try again." },
        { status: 409, headers: RESPONSE_HEADERS }
      );
    }

    console.error("Error rotating admin API key:", error);
    return NextResponse.json(
      { error: "Failed to create admin API key" },
      { status: 500, headers: RESPONSE_HEADERS }
    );
  }
}
