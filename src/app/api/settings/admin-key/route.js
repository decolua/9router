import { NextResponse } from "next/server";
import {
  createOrRotateAdminApiKey,
  getAdminApiKeyStatus,
} from "@/lib/auth/adminApiKey";
import { AdminApiKeyRotationConflictError } from "@/lib/localDb";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const RESPONSE_HEADERS = {
  "Cache-Control": "no-store",
};

export async function GET() {
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

export async function POST() {
  try {
    const result = await createOrRotateAdminApiKey();
    return NextResponse.json(result, {
      status: 201,
      headers: RESPONSE_HEADERS,
    });
  } catch (error) {
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
