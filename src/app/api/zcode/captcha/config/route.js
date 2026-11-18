import { NextResponse } from "next/server";
import { getCaptchaManager } from "@/lib/zcode/captcha-service";

export async function GET() {
  try {
    return NextResponse.json(await getCaptchaManager().fetchConfig());
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
