import { NextResponse } from "next/server";
import { getCaptchaManager } from "@/lib/zcode/captcha-service";

export async function POST() {
  try {
    await getCaptchaManager().onNeedsInteractive();
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}