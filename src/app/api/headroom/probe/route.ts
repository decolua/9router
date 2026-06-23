// Headroom server probe — used by the Compression → Headroom page to detect
// whether an external headroom server is already running on the machine and
// to validate custom URLs the user enters.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { validateUrl } from "@/shared/utils/ssrfGuard";
import { markDetected } from "@/lib/headroom/probeCache";
import { probeUrl, CANDIDATE_URLS } from "@/lib/headroom/probe";

export const dynamic = "force-dynamic";

// GET /api/headroom/probe?url=<custom-url>
//   No url param → probe default candidates and return first reachable
//   url param    → probe only that URL (must be loopback-allowed)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const custom = searchParams.get("url");

    if (custom) {
      // SSRF guard: allow loopback only, block cloud metadata, private IPs & external hosts
      const validation = validateUrl(custom, { allowLoopback: false, loopbackOnly: true });
      if (!validation.ok) {
        return NextResponse.json({ ok: false, error: validation.error }, { status: 400 });
      }
      const result = await probeUrl(validation.url.origin);
      return NextResponse.json({ url: validation.url.origin, ...result });
    }

    // Probe candidates in order; return first that responds like headroom
    for (const candidate of CANDIDATE_URLS) {
      const result = await probeUrl(candidate);
      if (result.ok) {
        markDetected(candidate);
        return NextResponse.json({
          url: candidate,
          ok: true,
          status: result.status,
          detected: true,
        });
      }
    }

    return NextResponse.json({
      url: null,
      ok: false,
      detected: false,
      message: "No headroom server detected on default ports. Enter a custom URL below.",
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "probe failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
