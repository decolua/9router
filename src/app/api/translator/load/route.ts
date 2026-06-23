import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import fs from "fs";
import path from "path";

const ALLOWED_FILES: ReadonlySet<string> = new Set([
  "1_req_client.json",
  "2_req_source.json",
  "3_req_openai.json",
  "4_req_target.json",
  "5_res_provider.txt",
  "6_res_openai.txt",
  "7_res_client.txt",
  "7_res_client.json",
]);

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const file = searchParams.get("file");

    if (!file) {
      return NextResponse.json({ success: false, error: "File parameter required" }, { status: 400 });
    }

    // Security: only allow specific filenames
    if (!ALLOWED_FILES.has(file)) {
      return NextResponse.json({ success: false, error: "Invalid file name" }, { status: 400 });
    }

    const logsDir = path.join(process.cwd(), "logs", "translator");
    const filePath = path.join(logsDir, file);

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ success: false, error: "File not found" }, { status: 404 });
    }

    const content = fs.readFileSync(filePath, "utf-8");

    return NextResponse.json({ success: true, content });
  } catch (error) {
    console.error("Error loading file:", error);
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
