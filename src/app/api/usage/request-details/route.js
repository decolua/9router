import { NextResponse } from "next/server";
import { getRequestDetails } from "@/lib/usageDb";
import { verifyDashboardAuthToken } from "@/lib/auth/dashboardSession";

/**
 * GET /api/usage/request-details
 * Query parameters: page, pageSize (1-100), provider, model, connectionId, status, startDate, endDate
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    
    const pageRaw = parseInt(searchParams.get("page"));
    const page = Number.isNaN(pageRaw) ? 1 : pageRaw;
    const pageSizeRaw = parseInt(searchParams.get("pageSize"));
    const pageSize = Number.isNaN(pageSizeRaw) ? 20 : pageSizeRaw;
    const provider = searchParams.get("provider");
    const model = searchParams.get("model");
    const connectionId = searchParams.get("connectionId");
    const status = searchParams.get("status");
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    
    if (page < 1) {
      return NextResponse.json(
        { error: "Page must be >= 1" },
        { status: 400 }
      );
    }
    
    if (pageSize < 1 || pageSize > 100) {
      return NextResponse.json(
        { error: "PageSize must be between 1 and 100" },
        { status: 400 }
      );
    }
    
    const filter = {
      page,
      pageSize
    };
    
    if (provider) filter.provider = provider;
    if (model) filter.model = model;
    if (connectionId) filter.connectionId = connectionId;
    if (status) filter.status = status;
    if (startDate) filter.startDate = startDate;
    if (endDate) filter.endDate = endDate;
    
    const result = await getRequestDetails(filter);

    // Redact conversation payloads for anyone who isn't a verified dashboard
    // owner. The stored details include full request bodies (user prompts,
    // tool calls) and provider responses. Returning them wholesale would let
    // any caller who reached this route without a real login (e.g. via the
    // requireLogin=false bypass) read every user's conversation history.
    // A valid dashboard JWT means the caller authenticated with the actual
    // password, so they get the unredacted payloads; everyone else gets
    // metadata only (model, tokens, latency, status).
    // Parse the raw Cookie header instead of request.cookies — this route is
    // exercised in tests with a plain Request (no NextRequest cookie jar).
    const cookieHeader = request.headers.get("cookie") || "";
    const match = cookieHeader.match(/(?:^|;\s*)auth_token=([^;]+)/);
    const token = match ? decodeURIComponent(match[1]) : undefined;
    const isOwner = await verifyDashboardAuthToken(token);

    const details = isOwner
      ? (result.details || [])
      : (result.details || []).map((d) => {
          const redacted = { ...d };
          for (const key of ["request", "providerRequest", "providerResponse", "response"]) {
            if (redacted[key] !== undefined) {
              redacted[key] = { redacted: true };
            }
          }
          return redacted;
        });

    return NextResponse.json({ ...result, details });
  } catch (error) {
    console.error("[API] Failed to get request details:", error);
    return NextResponse.json(
      { error: "Failed to fetch request details" },
      { status: 500 }
    );
  }
}
