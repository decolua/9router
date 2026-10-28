import { NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/localDb";
import { sanitizeProviderOrder } from "@/shared/utils/providerOrder";

export const dynamic = "force-dynamic";

const RESPONSE_HEADERS = { "Cache-Control": "no-store" };

// GET /api/settings/provider-order — the saved provider display order.
export async function GET() {
  try {
    const settings = await getSettings();
    return NextResponse.json(
      { order: sanitizeProviderOrder(settings.providerOrder) },
      { headers: RESPONSE_HEADERS },
    );
  } catch (error) {
    console.log("Error reading provider order:", error);
    return NextResponse.json({ order: [] }, { status: 500, headers: RESPONSE_HEADERS });
  }
}

// PUT /api/settings/provider-order — replace the saved order.
//
// Body: { order: string[] }. Ids are sanitized server-side (deduped, trimmed,
// length-capped) so a malformed client cannot bloat the settings row.
//
// This deliberately writes only `settings.providerOrder`. It must not touch
// `providerConnections.priority`, which drives account selection at request
// time — see the note at the top of src/shared/utils/providerOrder.js.
export async function PUT(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const order = sanitizeProviderOrder(body?.order);

    if (body?.order !== undefined && !Array.isArray(body.order)) {
      return NextResponse.json(
        { error: "order must be an array of provider ids" },
        { status: 400, headers: RESPONSE_HEADERS },
      );
    }

    const settings = await updateSettings({ providerOrder: order });
    return NextResponse.json(
      { order: sanitizeProviderOrder(settings.providerOrder) },
      { headers: RESPONSE_HEADERS },
    );
  } catch (error) {
    console.log("Error saving provider order:", error);
    return NextResponse.json(
      { error: "Failed to save provider order" },
      { status: 500, headers: RESPONSE_HEADERS },
    );
  }
}
