import { NextResponse } from "next/server";
import { killAppProcesses } from "@/lib/appUpdater";
import { isContainerDeploy } from "@/lib/deployMode";

// Shutdown app to release file locks for manual update
export async function POST() {
  // In a container this only kills the instance; the orchestrator restarts the same
  // image and nothing is updated. Redeploy instead.
  if (isContainerDeploy()) {
    return NextResponse.json(
      { success: false, message: "Container deploy: update by redeploying the image, not by shutting down." },
      { status: 409 }
    );
  }

  try {
    await killAppProcesses();
  } catch { /* best effort */ }

  const response = NextResponse.json({ success: true, message: "Shutting down for manual update..." });

  setTimeout(() => process.exit(0), 500);

  return response;
}
