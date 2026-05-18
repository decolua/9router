import { NextResponse } from "next/server";
import {
  WebshareAuthError,
  WebshareRateLimitError,
} from "@/lib/webshare/webshareClient.js";
import { runWebshareSync } from "@/lib/webshare/webshareSync.js";

export async function POST() {
  try {
    const stats = await runWebshareSync({ trigger: "manual" });

    return NextResponse.json({
      created: stats.created,
      updated: stats.updated,
      deactivated: stats.deactivated,
      skipped: stats.skipped,
      total: stats.total,
    });
  } catch (error) {
    console.log("Error importing Webshare proxies:", error);

    if (error instanceof WebshareAuthError) {
      return NextResponse.json({ error: "Webshare authentication failed" }, { status: 502 });
    }

    if (error instanceof WebshareRateLimitError) {
      return NextResponse.json({ error: "Webshare rate limit exceeded" }, { status: 502 });
    }

    const message = error instanceof Error ? error.message : "Failed to import Webshare proxies";

    if (message.includes("Refusing to deactivate all")) {
      return NextResponse.json({ error: message }, { status: 409 });
    }

    if (message.includes("No Webshare API key")) {
      return NextResponse.json({ error: message }, { status: 400 });
    }

    return NextResponse.json({ error: "Failed to import Webshare proxies" }, { status: 500 });
  }
}
