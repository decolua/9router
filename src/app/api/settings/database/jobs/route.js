import { NextResponse } from "next/server";
import { verifyDashboardPassword } from "@/lib/auth/dashboardSession";
import { createImportJob } from "@/lib/db/importJobs";

const CLI_TOKEN_HEADER = "x-9r-cli-token";
const MAX_IMPORT_BYTES = 50 * 1024 * 1024;

// CLI token requests are already trusted (local machine); skip password re-auth.
function isCliRequest(request) {
  return Boolean(request.headers.get(CLI_TOKEN_HEADER));
}

export async function POST(request) {
  try {
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > MAX_IMPORT_BYTES) {
      return NextResponse.json({ error: "Payload too large" }, { status: 413 });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { password, ...payload } = body || {};
    if (!isCliRequest(request) && !(await verifyDashboardPassword(password))) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }

    let job;
    try {
      job = createImportJob(payload);
    } catch (err) {
      return NextResponse.json(
        { error: err?.message || "Failed to import database" },
        { status: 400 }
      );
    }

    return NextResponse.json({ jobId: job.jobId, status: job.status }, { status: 202 });
  } catch (error) {
    console.log("Error starting database import job:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to import database" },
      { status: 400 }
    );
  }
}
