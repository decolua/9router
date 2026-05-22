import { videosExtend } from "@/lib/providers/xai/videos.js";
import { persistXaiAccount, resolveXaiAccount } from "../_xaiAccount.js";

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

/** POST /v1/videos/extensions — multipart upload, xAI only */
export async function POST(request) {
  const account = await resolveXaiAccount(request);
  if (!account) return Response.json({ error: "No xAI connection" }, { status: 401 });

  let formData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ error: "Invalid multipart body" }, { status: 400 });
  }

  try {
    const idem = request.headers.get("Idempotency-Key") || undefined;
    const json = await videosExtend({
      formData,
      account,
      idempotencyKey: idem,
      persist: persistXaiAccount,
    });
    return Response.json(json);
  } catch (err) {
    return Response.json(
      { error: err?.message || String(err) },
      { status: err?.status || 500 }
    );
  }
}
