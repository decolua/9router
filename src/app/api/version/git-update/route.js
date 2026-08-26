import { NextResponse } from "next/server";

import { getGitUpdateStatus, startGitUpdate } from "@/lib/gitUpdate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const RESPONSE_HEADERS = { "Cache-Control": "no-store" };

export async function GET(request) {
  try {
    const refresh = new URL(request.url).searchParams.get("refresh") !== "0";
    const status = await getGitUpdateStatus({ refresh });
    return NextResponse.json(status, { headers: RESPONSE_HEADERS });
  } catch (error) {
    return NextResponse.json(
      { repositoryAvailable: false, error: error.message },
      { status: 500, headers: RESPONSE_HEADERS },
    );
  }
}

export async function POST() {
  if (process.env.NODE_ENV !== "production") {
    return NextResponse.json(
      { success: false, error: "Git update is only available in production" },
      { status: 403, headers: RESPONSE_HEADERS },
    );
  }

  try {
    const status = await getGitUpdateStatus({ refresh: true });
    if (!status.updateAvailable) {
      return NextResponse.json(
        { success: false, error: "No Git update is available", status },
        { status: 409, headers: RESPONSE_HEADERS },
      );
    }
    if (!status.canUpdate) {
      return NextResponse.json(
        { success: false, error: status.blockedReason || "Repository cannot be updated automatically", status },
        { status: 409, headers: RESPONSE_HEADERS },
      );
    }

    const operation = startGitUpdate({ repoRoot: status.repoRoot });
    return NextResponse.json(
      { success: true, message: "Git update started", operation },
      { status: 202, headers: RESPONSE_HEADERS },
    );
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500, headers: RESPONSE_HEADERS },
    );
  }
}
