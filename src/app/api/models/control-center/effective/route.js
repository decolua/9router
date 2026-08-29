import { NextResponse } from "next/server";

import {
  buildEffectiveModelSet,
} from "@/lib/modelControlCenter/effective.js";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const state =
      await buildEffectiveModelSet();

    return NextResponse.json(state);
  } catch (error) {
    console.log(
      "[modelControlCenter] effective preview failed:",
      error,
    );

    return NextResponse.json(
      {
        error:
          error?.message
          || "Effective model preview failed",
      },
      {
        status: 500,
      },
    );
  }
}
