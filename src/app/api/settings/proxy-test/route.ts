import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { JsonValue } from "open-sse/types/executor.js";
import { testProxyUrl } from "@/lib/network/proxyTest";

export async function POST(request: NextRequest) {
  try {
    const parsed: JsonValue = await request.json();
    const proxyUrl =
      parsed && typeof parsed === "object" && !Array.isArray(parsed) && typeof parsed["proxyUrl"] === "string"
        ? parsed["proxyUrl"]
        : undefined;
    const testUrl =
      parsed && typeof parsed === "object" && !Array.isArray(parsed) && typeof parsed["testUrl"] === "string"
        ? parsed["testUrl"]
        : undefined;
    const timeoutMs =
      parsed && typeof parsed === "object" && !Array.isArray(parsed) && typeof parsed["timeoutMs"] === "number"
        ? parsed["timeoutMs"]
        : undefined;

    const result = await testProxyUrl({ proxyUrl, testUrl, timeoutMs });

    if (result?.ok) {
      return NextResponse.json(result);
    }

    const status = typeof result?.status === "number" ? result.status : 500;
    return NextResponse.json({ ok: false, error: result?.error ?? "Proxy test failed" }, { status });
  } catch (err) {
    const message =
      err instanceof Error && err.name === "AbortError"
        ? "Proxy test timed out"
        : err instanceof Error
          ? err.message
          : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
