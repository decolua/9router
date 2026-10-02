import { NextResponse } from "next/server";
import { getRequestDetails, flushRequestDetailsNow } from "@/lib/usageDb";
import { getSettings } from "@/lib/localDb";

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
    const apiKey = searchParams.get("apiKey");
    const customer = searchParams.get("customer");
    const ip = searchParams.get("ip");
    
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
    if (status && status !== "all") filter.status = status;
    if (startDate) filter.startDate = startDate;
    if (endDate) filter.endDate = endDate;
    if (apiKey) filter.apiKey = apiKey;
    if (customer) filter.customer = customer;
    if (ip) filter.ip = ip;
    
    // Ensure in-memory buffered records are persisted before querying
    await flushRequestDetailsNow().catch(() => {});

    const result = await getRequestDetails(filter);

    const settings = await getSettings();
    const shouldRedact = settings.redactRequestPayloads === true;

    const details = shouldRedact
      ? (result.details || []).map((d) => {
          const redacted = { ...d };
          for (const key of ["request", "providerRequest", "providerResponse", "response"]) {
            if (redacted[key] !== undefined) {
              redacted[key] = { redacted: true };
            }
          }
          return redacted;
        })
      : (result.details || []);

    return NextResponse.json({ ...result, details });
  } catch (error) {
    console.error("[API] Failed to get request details:", error);
    return NextResponse.json(
      { error: "Failed to fetch request details" },
      { status: 500 }
    );
  }
}
