import { enforceApiKeyQuota } from "@/shared/services/apiKeyQuota";

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

export async function GET(request) {
  const quota = await enforceApiKeyQuota(request, { consumeRequest: false });
  if (!quota.ok) {
    return quota.response;
  }

  const key = quota.apiKey;
  const requestLimit = Number(key.requestLimit || 0);
  const tokenLimit = Number(key.tokenLimit || 0);
  const requestUsed = Number(key.requestUsed || 0);
  const tokenUsed = Number(key.tokenUsed || 0);

  return new Response(
    JSON.stringify({
      id: key.id,
      name: key.name,
      ownerName: key.ownerName || "",
      ownerEmail: key.ownerEmail || "",
      ownerAge: Number.isFinite(Number(key.ownerAge)) ? Number(key.ownerAge) : null,
      requestLimit,
      tokenLimit,
      requestUsed,
      tokenUsed,
      allowedModels: key.allowedModels || [],
      requestRemaining: requestLimit > 0 ? Math.max(0, requestLimit - requestUsed) : null,
      tokenRemaining: tokenLimit > 0 ? Math.max(0, tokenLimit - tokenUsed) : null,
    }),
    {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    },
  );
}
