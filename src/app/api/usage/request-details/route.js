import { NextResponse } from "next/server";
import { flushRequestDetails, getRequestDetails } from "@/lib/usageDb";

/**
 * GET /api/usage/request-details
 * Query parameters: page, pageSize (1-100), provider, model, connectionId, status, startDate, endDate
 * List items carry metadata only; full payloads come from GET /api/usage/request-details/[id].
 */
const PAYLOAD_KEYS = ["request", "providerRequest", "providerResponse", "response"];

function stripPayloads(detail) {
  const meta = { ...(detail || {}) };
  let bytes = 0;
  for (const key of PAYLOAD_KEYS) {
    const value = meta[key];
    delete meta[key];
    if (value === undefined || value === null) continue;
    try {
      bytes += JSON.stringify(value).length;
    } catch {
      continue;
    }
  }
  meta.hasDetail = true;
  meta.payloadBytes = bytes;
  return meta;
}

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

    await flushRequestDetails();
    const result = await getRequestDetails(filter);
    const details = (result.details || []).map(stripPayloads);

    return NextResponse.json({ ...result, details });
  } catch (error) {
    console.error("[API] Failed to get request details:", error);
    return NextResponse.json(
      { error: "Failed to fetch request details" },
      { status: 500 }
    );
  }
}
