import { NextResponse } from "next/server";
import { getSettings } from "@/lib/localDb";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const body = await request.json();
    let token = body.telegramBotToken;
    const chatId = body.telegramChatId;

    const settings = await getSettings();
    if (token === "••••••••") {
      token = settings.telegramBotToken;
    }

    if (!token || !chatId) {
      return NextResponse.json({ error: "Bot token and chat ID are required." }, { status: 400 });
    }

    const testText = "🔔 *9Router Notification Test*\n\nYour Telegram integration is working perfectly! 🎉";
    const url = `https://api.telegram.org/bot${token}/sendMessage`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: testText,
        parse_mode: "Markdown",
      }),
    });

    const data = await response.json();
    if (response.ok && data.ok) {
      return NextResponse.json({ ok: true });
    } else {
      return NextResponse.json(
        { error: data.description || "Failed to send test message via Telegram API" },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error("Telegram notification test failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
