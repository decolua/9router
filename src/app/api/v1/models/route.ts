import type { NextRequest } from "next/server";
import type { JsonValue } from "open-sse/types/executor.js";
import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";
import { buildModelsList, LLM_KIND } from "./buildModelsList.js";

/** Handle CORS preflight */
export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

/**
 * GET /v1/models - OpenAI compatible models list (LLM/chat models only by default).
 * For other capabilities use /v1/models/{kind} (image, tts, stt, embedding, image-to-text, web).
 */
export async function GET(request: NextRequest) {
  try {
    const data = await buildModelsList([LLM_KIND]);
    const headers = { "Access-Control-Allow-Origin": "*" };
    const originator = request.headers.get("originator") ?? "";
    const userAgent = request.headers.get("user-agent") ?? "";
    const isCodex = originator === "codex_cli_rs" || /codex/i.test(userAgent);
    if (isCodex) {
      const models = data.map((m) => {
        const provider =
          typeof m.id === "string" && m.id.includes("/")
            ? m.id.split("/")[0] ?? ""
            : (m.owned_by ?? "");
        const caps = getCapabilitiesForModel(provider, m.id);
        return {
          slug: m.id,
          display_name: m.id,
          supported_in_api: true,
          supports_search_tool: !!((caps as Record<string, JsonValue> | null)?.["search"]),
          tool_mode: "auto",
          multi_agent_version: null,
        };
      });
      return Response.json({ models }, { headers });
    }
    return Response.json({ object: "list", data }, { headers });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log("Error fetching models:", err);
    return Response.json(
      { error: { message, type: "server_error" } },
      { status: 500 },
    );
  }
}
