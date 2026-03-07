import { NextResponse } from "next/server";
import { updateSettings } from "@/lib/localDb";
import {
  getQuotaAutoTriggerService,
  getQuotaAutoTriggerSnapshot,
} from "@/shared/services/quotaAutoTriggerService";

export async function GET() {
  try {
    const service = getQuotaAutoTriggerService();
    const snapshot = await getQuotaAutoTriggerSnapshot();
    return NextResponse.json({
      ...snapshot,
      running: service.isRunning(),
    });
  } catch (error) {
    console.error("[QuotaAutoTrigger] GET failed:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch quota auto-trigger settings" },
      { status: 500 }
    );
  }
}

export async function PATCH(request) {
  try {
    const body = await request.json();
    const enabled = body?.enabled === true;

    await updateSettings({ quotaAutoTriggerEnabled: enabled });

    const service = getQuotaAutoTriggerService();
    if (enabled) {
      service.run({ reason: "manual-enable", force: true }).catch((error) => {
        console.error("[QuotaAutoTrigger] Enable run failed:", error);
      });
    }

    const snapshot = await getQuotaAutoTriggerSnapshot();
    return NextResponse.json({
      ...snapshot,
      running: service.isRunning(),
    });
  } catch (error) {
    console.error("[QuotaAutoTrigger] PATCH failed:", error);
    return NextResponse.json(
      { error: error.message || "Failed to update quota auto-trigger settings" },
      { status: 500 }
    );
  }
}
