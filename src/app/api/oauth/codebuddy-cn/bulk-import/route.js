import { NextResponse } from "next/server";
import { getCodeBuddyCnPhoneImportManager } from "@/lib/oauth/services/codebuddyCnPhoneImportManager";
import { resolveBulkImportProxy } from "@/lib/oauth/services/bulkImportProxyResolver";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const body = await request.json();
    const { proxyUrl, proxyUrls, proxyMode, proxyPoolId, proxySource, error: proxyError } = await resolveBulkImportProxy({
      proxyPoolId: body?.proxyPoolId,
      proxyUrl: body?.proxyUrl,
    });
    if (proxyError) {
      return NextResponse.json({ error: proxyError }, { status: 400 });
    }

    const manager = getCodeBuddyCnPhoneImportManager();
    const job = await manager.startJob({
      fiveSimToken: body?.fiveSimToken,
      count: body?.count,
      concurrency: body?.concurrency,
      engine: body?.engine,
      proxyUrl,
      proxyUrls,
      proxyMode,
      proxyPoolId,
      proxySource,
      country: body?.country,
      operator: body?.operator,
      product: body?.product,
    });

    return NextResponse.json({
      success: true,
      job,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Failed to start CodeBuddy CN phone import" },
      { status: 400 }
    );
  }
}
