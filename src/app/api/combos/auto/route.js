import {
  NextResponse,
} from "next/server";

import {
  getAutoComboSnapshot,
} from "@/lib/autoCombo/service.js";

export const dynamic =
  "force-dynamic";

function boolParam(
  value,
  fallback,
) {
  if (value === null) {
    return fallback;
  }

  return (
    value === "1" ||
    value === "true" ||
    value === "yes"
  );
}

export async function GET(request) {
  try {
    const url =
      new URL(request.url);

    const snapshot =
      await getAutoComboSnapshot({
        forceInventoryRefresh:
          boolParam(
            url.searchParams.get(
              "force",
            ),
            false,
          ),

        includeDynamic:
          boolParam(
            url.searchParams.get(
              "includeDynamic",
            ),
            true,
          ),
      });

    return NextResponse.json(
      snapshot,
    );
  } catch (error) {
    console.error(
      "[C6.3][auto-combo] GET failed:",
      error,
    );

    return NextResponse.json(
      {
        error:
          "Failed to generate auto combos",
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
      await request
        .json()
        .catch(
          () => ({}),
        );

    const snapshot =
      await getAutoComboSnapshot({
        forceInventoryRefresh:
          body.forceInventoryRefresh ===
          true,

        includeDynamic:
          body.includeDynamic !==
          false,
      });

    return NextResponse.json(
      snapshot,
    );
  } catch (error) {
    console.error(
      "[C6.3][auto-combo] POST failed:",
      error,
    );

    return NextResponse.json(
      {
        error:
          "Failed to regenerate auto combos",
      },
      {
        status: 500,
      },
    );
  }
}
