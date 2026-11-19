import { getProviderQuotaWindows } from "@/shared/services/accountQuotaWindows";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const provider = new URL(request.url).searchParams.get("provider");
  if (!["claude", "codex"].includes(provider)) {
    return Response.json({ error: "Supported provider required: claude or codex" }, { status: 400 });
  }
  try {
    return Response.json(await getProviderQuotaWindows(provider), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Failed to read quota windows" }, { status: 500 });
  }
}
