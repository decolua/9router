import { NextResponse } from "next/server";
import { getCaptchaManager } from "@/lib/zcode/captcha-service";

export async function POST(request) {
  try {
    const { verifyParam } = await request.json();
    getCaptchaManager().submit(verifyParam);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
