import { NextResponse } from "next/server";
import { getCaptchaManager } from "@/lib/zcode/captcha-service";

export async function GET() {
  try {
    const captchaConfig = await getCaptchaManager().fetchCaptchaConfig();
    return NextResponse.json(captchaConfig);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}