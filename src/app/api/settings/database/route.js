import { NextResponse } from "next/server";
import { createBackupDownload, getDatabaseInfo, importDb, getSettings } from "@/lib/localDb";
import { applyOutboundProxyEnv } from "@/lib/network/outboundProxy";

export async function GET(request) {
  try {
    const url = new URL(request.url);
    if (url.searchParams.get("info") === "1") {
      return NextResponse.json(getDatabaseInfo());
    }

    const backup = await createBackupDownload();
    return new NextResponse(backup.content, {
      headers: {
        "Content-Type": backup.contentType,
        "Content-Disposition": `attachment; filename="${backup.filename}"`,
        "X-Backup-Format": backup.format,
      },
    });
  } catch (error) {
    console.log("Error exporting database:", error);
    return NextResponse.json({ error: error?.message || "Failed to export database" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const contentType = request.headers.get("content-type") || "";

    if (contentType.includes("application/sql") || contentType.includes("text/plain")) {
      const sql = await request.text();
      await importDb(sql);
    } else {
      const payload = await request.json();
      await importDb(payload);
    }

    try {
      const settings = await getSettings();
      applyOutboundProxyEnv(settings);
    } catch (err) {
      console.warn("[Settings][DatabaseImport] Failed to re-apply outbound proxy env:", err);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.log("Error importing database:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to import database" },
      { status: 400 }
    );
  }
}
