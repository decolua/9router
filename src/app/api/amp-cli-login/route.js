"use server";

import { NextResponse } from "next/server";
import { requestAmpLogin } from "@/lib/amp/login";

/**
 * POST /api/amp-cli-login
 * Request Amp CLI authentication and return auth URL
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const { apiKey } = body;

    if (!apiKey || typeof apiKey !== "string") {
      console.error("[Amp CLI Login] Missing or invalid API key");
      return NextResponse.json(
        { error: "API key is required" },
        { status: 400 }
      );
    }

    console.log("[Amp CLI Login] Requesting login from Amp API...");

    // Call the Amp login helper
    const loginData = await requestAmpLogin(apiKey);

    console.log("[Amp CLI Login] Login request successful, verification code:", loginData.verificationCode);

    return NextResponse.json({
      success: true,
      authUrl: loginData.authUrl,
      verificationCode: loginData.verificationCode,
      expiresAt: loginData.expiresAt,
      message: "Please open the auth URL in your browser to complete login",
    });
  } catch (error) {
    console.error("[Amp CLI Login] Error:", error.message);

    return NextResponse.json(
      {
        error: error.message || "Failed to request Amp login",
        details: process.env.NODE_ENV === "development" ? error.stack : undefined
      },
      { status: 500 }
    );
  }
}
