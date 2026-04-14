import { NextResponse } from "next/server";
import { sendTestNotification } from "@/lib/notificationService";

export async function POST(request) {
  try {
    const body = await request.json();
    const urls = body.urls || (body.url ? [body.url] : []);

    if (urls.length === 0) {
      return NextResponse.json({ success: false, error: "No webhook URLs provided" }, { status: 400 });
    }

    const result = await sendTestNotification(urls);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
