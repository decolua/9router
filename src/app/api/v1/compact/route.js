import { NextResponse } from "next/server";
import { handleCompactCore } from "open-sse/handlers/compactCore.js";
import { getProviderCredentials } from "@/sse/services/auth.js";

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { messages, query, compressionRatio, preserveRecent } = body;

  // Resolve Morph provider credentials from localDb
  let morphCreds;
  try {
    morphCreds = await getProviderCredentials("morph", null, null);
  } catch {
    morphCreds = null;
  }

  const result = await handleCompactCore({
    messages,
    query,
    compressionRatio,
    preserveRecent,
    apiKey: morphCreds?.apiKey || null,
  });

  if (result.success) return result.response;
  return NextResponse.json({ error: result.error }, { status: result.status });
}

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}
