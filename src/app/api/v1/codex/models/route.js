import { getCodexNativeCatalog } from "@/lib/codexNative/catalog.js";
import { refreshCodexNativePoolUsage } from "@/lib/codexNative/pool.js";
import { codexNativeAuthError, validateCodexNativeClient } from "@/lib/codexNative/clientAuth.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

export async function OPTIONS() {
  return new Response(null, { headers: corsHeaders });
}

export async function GET(request) {
  try {
    const auth = await validateCodexNativeClient(request);
    if (!auth.ok) return codexNativeAuthError(auth);
    const url = new URL(request.url);
    const clientVersion = url.searchParams.has("client_version")
      ? url.searchParams.get("client_version")
      : null;
    if (!clientVersion) {
      return Response.json({
        error: {
          type: "invalid_request_error",
          code: "missing_client_version",
          message: "client_version is required",
        },
      }, { status: 400, headers: corsHeaders });
    }
    const catalog = await getCodexNativeCatalog({ clientVersion });
    refreshCodexNativePoolUsage().catch(() => {});

    if (request.headers.get("if-none-match") === catalog.etag) {
      return new Response(null, {
        status: 304,
        headers: {
          ...corsHeaders,
          ETag: catalog.etag,
          "x-models-etag": catalog.etag,
        },
      });
    }

    return Response.json({ models: catalog.models }, {
      headers: {
        ...corsHeaders,
        ETag: catalog.etag,
        "x-models-etag": catalog.etag,
        "Cache-Control": "private, max-age=60",
        "X-9Router-Codex-Catalog": catalog.source,
        "X-9Router-Codex-Catalog-Stale": String(catalog.stale === true),
      },
    });
  } catch (error) {
    return Response.json({
      error: {
        type: "server_error",
        code: "codex_catalog_unavailable",
        message: error.message,
      },
    }, { status: 503, headers: corsHeaders });
  }
}
