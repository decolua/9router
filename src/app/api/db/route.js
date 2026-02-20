import { NextResponse } from "next/server";
import { exportDb, importDb, isCloudEnabled } from "@/models";
import { getConsistentMachineId } from "@/shared/utils/machineId";
import { syncToCloud } from "@/app/api/sync/cloud/route";

export async function GET(request) {
  try {
    const data = await exportDb();
    const shouldDownload = request.nextUrl.searchParams.get("download") === "1";
    if (shouldDownload) {
      const payload = JSON.stringify(data || {}, null, 2);
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `9router-db-${timestamp}.json`;
      return new NextResponse(payload, {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      });
    }
    return NextResponse.json({ data });
  } catch (error) {
    console.log("Error exporting db:", error);
    return NextResponse.json({ error: "Failed to export database" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || !body.data) {
      return NextResponse.json({ error: "Invalid database payload" }, { status: 400 });
    }

    await importDb(body.data);
    await syncToCloudIfEnabled();

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.log("Error importing db:", error);
    return NextResponse.json({ error: "Failed to import database" }, { status: 500 });
  }
}

async function syncToCloudIfEnabled() {
  try {
    const cloudEnabled = await isCloudEnabled();
    if (!cloudEnabled) return;

    const machineId = await getConsistentMachineId();
    await syncToCloud(machineId);
  } catch (error) {
    console.log("Error syncing db to cloud:", error);
  }
}
