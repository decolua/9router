import { NextResponse } from "next/server";

import {
  buildPolicyDryRun,
} from "@/lib/modelControlCenter/dryRun.js";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const state =
      await buildPolicyDryRun();

    return NextResponse.json(state);
  } catch (error) {
    console.log(
      "[modelControlCenter] policy dry-run failed:",
      error,
    );

    return NextResponse.json(
      {
        error:
          error?.message
          || "Policy dry-run failed",
      },
      {
        status: 500,
      },
    );
  }
}
