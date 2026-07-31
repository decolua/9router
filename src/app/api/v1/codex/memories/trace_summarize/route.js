import { relayCodexNativeHttp } from "@/lib/codexNative/relay.js";
import { CODEX_NATIVE_CONFIG } from "open-sse/config/codexNative.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  return relayCodexNativeHttp(request, {
    path: CODEX_NATIVE_CONFIG.paths.memories,
    operation: "memories",
  });
}
