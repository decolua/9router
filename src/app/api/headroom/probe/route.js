// Headroom server probe — used by the Compression → Headroom page to detect
// whether an external headroom server is already running on the machine and
// to validate custom URLs the user enters.
import { NextResponse } from "next/server";
import { validateUrl } from "@/shared/utils/ssrfGuard";

export const dynamic = "force-dynamic";

const CANDIDATE_URLS = [
  "http://localhost:8787",
  "http://127.0.0.1:8787",
];

const PROBE_TIMEOUT_MS = 1500;

async function probeUrl(url) {
  const endpoint = `${String(url).replace(/\/$/, "")}/v1/compress`;
  const probeBody = {
    messages: [{ role: "user", content: "ping" }],
    model: "probe",
  };
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(probeBody),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, status: res.status };
    const data = await res.json().catch(() => null);
    // A real headroom server returns { messages: [...] } with token stats
    const looksLikeHeadroom = data && (
      Array.isArray(data.messages) ||
      typeof data.tokens_saved === "number" ||
      typeof data.tokens_before === "number"
    );
    return { ok: !!looksLikeHeadroom, status: res.status, data };
  } catch (e) {
    return { ok: false, error: e?.message || "unreachable" };
  }
}

// GET /api/headroom/probe?url=<custom-url>
//   No url param → probe default candidates and return first reachable
//   url param    → probe only that URL (must be loopback-allowed)
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const custom = searchParams.get("url");

    if (custom) {
      // SSRF guard: allow loopback only, block cloud metadata, private IPs & external hosts
      const validation = validateUrl(custom, { loopbackOnly: true });
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
        return NextResponse.json({
          url: candidate,
          ok: true,
          status: result.status,
          detected: true,
        });
      }
      // Continue to next candidate on failure
    }

    return NextResponse.json({
      url: null,
      ok: false,
      detected: false,
      message: "No headroom server detected on default ports. Enter a custom URL below.",
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e?.message || "probe failed" },
      { status: 500 }
    );
  }
}
