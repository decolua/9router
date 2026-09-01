import {
  NextResponse,
} from "next/server";

import {
  ensureModelInventoryFresh,
  ensureModelInventoryScheduler,
  getModelInventorySchedulerStatus,
} from "@/lib/modelInventory/scheduler.js";

import {
  probeModelInventory,
  refreshModelInventory,
} from "@/lib/modelInventory/service.js";

export async function GET() {
  try {
    ensureModelInventoryScheduler();

    const snapshot =
      await ensureModelInventoryFresh();

    return NextResponse.json({
      ...snapshot,
      scheduler:
        getModelInventorySchedulerStatus(),
    });
  } catch (error) {
    console.error(
      "[C6.2][inventory] GET failed:",
      error,
    );

    return NextResponse.json(
      {
        error:
          "Failed to build model inventory",
      },
      {
        status: 500,
      },
    );
  }
}

export async function POST(request) {
  try {
    const body =
      await request.json().catch(
        () => ({}),
      );

    ensureModelInventoryScheduler();

    let snapshot =
      await refreshModelInventory({
        force:
          body.force !== false,

        includeDynamic:
          body.includeDynamic !== false,
      });

    if (body.probe === true) {
      snapshot =
        await probeModelInventory({
          limitPerConnection:
            body.limitPerConnection,
        });
    }

    return NextResponse.json({
      ...snapshot,
      scheduler:
        getModelInventorySchedulerStatus(),
    });
  } catch (error) {
    console.error(
      "[C6.2][inventory] POST failed:",
      error,
    );

    return NextResponse.json(
      {
        error:
          "Failed to refresh model inventory",
      },
      {
        status: 500,
      },
    );
  }
}
