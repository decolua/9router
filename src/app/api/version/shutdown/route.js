import { NextResponse } from "next/server";
import { killAppProcesses } from "@/lib/appUpdater";
import { closeDb } from "@/lib/db/driver";

// Shutdown app to release file locks for manual update
export async function POST() {
  try {
    await closeDb();
  } catch { /* best effort */ }

  try {
    await killAppProcesses();
  } catch { /* best effort */ }

  const response = NextResponse.json({ success: true, message: "Shutting down for manual update..." });

  setTimeout(() => process.exit(0), 500);

  return response;
}
