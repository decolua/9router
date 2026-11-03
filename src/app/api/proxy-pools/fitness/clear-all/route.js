import { NextResponse } from "next/server";
import { clearAllPoolUnfit } from "../../../../../../open-sse/services/proxyPoolFitness.js";

// POST /api/proxy-pools/fitness/clear-all
export async function POST(req) {
  try {
    const body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const provider = typeof body.provider === "string" ? body.provider : "";

    if (!provider || !provider.trim()) {
      return NextResponse.json(
        { error: "provider is required" },
        { status: 400 }
      );
    }

    const validProviderRegex = /^[a-z0-9-]+$/;
    if (!validProviderRegex.test(provider)) {
      return NextResponse.json(
        { error: "Invalid provider format" },
        { status: 400 }
      );
    }

    const success = await clearAllPoolUnfit(provider);
    if (!success) {
      return NextResponse.json(
        { error: "Failed to clear proxy fitness" },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, provider });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: "Failed to clear proxy fitness" },
      { status: 500 }
    );
  }
}
