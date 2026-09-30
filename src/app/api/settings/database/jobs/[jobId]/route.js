import { NextResponse } from "next/server";
import { verifyDashboardPassword } from "@/lib/auth/dashboardSession";
import { getImportJob } from "@/lib/db/importJobs";

const CLI_TOKEN_HEADER = "x-9r-cli-token";
const PASSWORD_HEADER = "x-9r-password";

// CLI token requests are already trusted (local machine); skip password re-auth.
function isCliRequest(request) {
  return Boolean(request.headers.get(CLI_TOKEN_HEADER));
}

export async function GET(request, context) {
  try {
    if (!isCliRequest(request) && !(await verifyDashboardPassword(request.headers.get(PASSWORD_HEADER)))) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }

    const jobId = context?.params?.jobId;
    if (!jobId) {
      return NextResponse.json({ error: "Missing job id" }, { status: 400 });
    }

    const job = getImportJob(jobId);
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const response = {
      status: job.status,
      progress: job.progress?.percent ?? 0,
      section: job.progress?.currentSection || null,
      message: job.message || null,
    };
    if (job.status === "error") {
      response.error = job.error || "Failed to import database";
    }
    return NextResponse.json(response);
  } catch (error) {
    console.log("Error reading database import job:", error);
    return NextResponse.json({ error: "Failed to read import job" }, { status: 500 });
  }
}
