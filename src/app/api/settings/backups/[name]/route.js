import fs from "node:fs";
import path from "node:path";
import { BACKUPS_DIR } from "@/lib/db/paths.js";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  try {
    const { name } = await params;

    // Prevent directory traversal
    if (!name || name.includes("..") || name.includes("/") || name.includes("\\")) {
      return NextResponse.json({ error: "Invalid backup name" }, { status: 400 });
    }

    const backupDir = path.join(BACKUPS_DIR, name);
    if (!fs.existsSync(backupDir)) {
      return NextResponse.json({ error: "Backup not found" }, { status: 404 });
    }

    // Look for JSON files in the backup directory
    const jsonFiles = fs.readdirSync(backupDir).filter((f) => f.endsWith(".json"));
    if (jsonFiles.length === 0) {
      return NextResponse.json({ error: "No backup data found" }, { status: 404 });
    }

    const filePath = path.join(backupDir, jsonFiles[0]);
    const content = fs.readFileSync(filePath, "utf-8");

    return new NextResponse(content, {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${name}.json"`,
      },
    });
  } catch (error) {
    console.error("Error reading backup:", error);
    return NextResponse.json({ error: "Failed to read backup" }, { status: 500 });
  }
}
