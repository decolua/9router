import { NextResponse } from "next/server";
import { getErrorHistory, clearErrorHistory } from "@/lib/errorHistoryDb";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const filter = {
      connectionId: searchParams.get("connectionId") || undefined,
      provider: searchParams.get("provider") || undefined,
      statusCode: searchParams.get("statusCode") || undefined,
      page: searchParams.get("page") || 1,
      pageSize: searchParams.get("pageSize") || 20,
    };

    const result = await getErrorHistory(filter);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const connectionId = searchParams.get("connectionId") || null;
    await clearErrorHistory(connectionId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
