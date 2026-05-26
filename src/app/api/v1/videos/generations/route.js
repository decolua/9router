import { videosGenerate } from "@/lib/providers/xai/videos.js";
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

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const account = await resolveXaiAccount(request);
  if (!account) return Response.json({ error: "No xAI connection" }, { status: 401 });

  try {
    const idem = request.headers.get("Idempotency-Key") || undefined;
    const json = await videosGenerate({
      request: body,
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
