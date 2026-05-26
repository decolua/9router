import fs from "node:fs";
import path from "node:path";
import { BACKUPS_DIR } from "@/lib/db/paths.js";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    if (!fs.existsSync(BACKUPS_DIR)) {
      return NextResponse.json({ backups: [] });
    }

    const entries = fs.readdirSync(BACKUPS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => {
        const name = e.name;
        // Parse type from directory name: "auto-1.0.0-20260516-103000" or "pre-import-1.0.0-20260516-110000"
        const type = name.startsWith("pre-import") ? "pre-import" : "auto";

        // Parse timestamp from directory name
        // Format: {label}-{version}-{YYYYMMDD}-{HHMMSS}
        const tsMatch = name.match(/(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/);
        let date = null;
        if (tsMatch) {
          const [, y, mo, d, h, mi, s] = tsMatch;
          date = `${y}-${mo}-${d}T${h}:${mi}:${s}Z`;
        }

        return { name, date, type };
      })
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""));

    return NextResponse.json({ backups: entries });
  } catch (error) {
    console.error("Error listing backups:", error);
    return NextResponse.json({ error: "Failed to list backups" }, { status: 500 });
  }
}
