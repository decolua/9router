import { videosGet } from "@/lib/providers/xai/videos.js";
import { persistXaiAccount, resolveXaiAccount } from "../_xaiAccount.js";

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

/** GET /v1/videos/{id} — poll status of an async video job (xAI) */
export async function GET(request, { params }) {
  const { id } = await params;
  const account = await resolveXaiAccount(request);
  if (!account) return Response.json({ error: "No xAI connection" }, { status: 401 });

  try {
    const json = await videosGet({ id, account, persist: persistXaiAccount });
    return Response.json(json);
  } catch (err) {
    return Response.json(
      { error: err?.message || String(err) },
      { status: err?.status || 500 }
    );
  }
}
