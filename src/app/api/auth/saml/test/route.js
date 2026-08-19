import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSettings } from "@/lib/localDb";
import { formatX509Certificate } from "@/lib/auth/saml.js";
import { verifyDashboardAuthToken } from "@/lib/auth/dashboardSession";

async function canAccessTestRoute() {
  const settings = await getSettings();
  if (settings.requireLogin === false) return true;

  const cookieStore = await cookies();
  const token = cookieStore.get("auth_token")?.value;
  return await verifyDashboardAuthToken(token);
}

export async function POST(request) {
  try {
    if (!(await canAccessTestRoute())) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const settings = await getSettings();

    const samlEntryPoint = String(body.samlEntryPoint || settings.samlEntryPoint || "").trim();
    const samlIssuer = String(body.samlIssuer || settings.samlIssuer || "urn:10router:sp").trim();
    const samlCert = String(
      Object.prototype.hasOwnProperty.call(body, "samlCert")
        ? body.samlCert
        : settings.samlCert || ""
    ).trim();

    if (!samlEntryPoint) {
      return NextResponse.json({ error: "Single Sign-On Service URL (samlEntryPoint) is required" }, { status: 400 });
    }

    try {
      new URL(samlEntryPoint);
    } catch {
      return NextResponse.json({ error: "Single Sign-On Service URL must be a valid URL" }, { status: 400 });
    }

    if (!samlIssuer) {
      return NextResponse.json({ error: "SP Entity ID / Issuer (samlIssuer) is required" }, { status: 400 });
    }

    if (!samlCert) {
      return NextResponse.json({ error: "IdP X.509 Certificate (samlCert) is required" }, { status: 400 });
    }

    const formattedCert = formatX509Certificate(samlCert);
    if (!formattedCert) {
      return NextResponse.json({ error: "Invalid IdP X.509 Certificate format" }, { status: 400 });
    }

    const origin = new URL(request.url).origin;
    const acsUrl = `${origin}/api/auth/saml/acs`;
    const metadataUrl = `${origin}/api/auth/saml/metadata`;

    return NextResponse.json({
      ok: true,
      samlEntryPoint,
      samlIssuer,
      certValid: true,
      acsUrl,
      metadataUrl,
      message: "SAML 2.0 configuration verified successfully.",
    });
  } catch (error) {
    return NextResponse.json({ error: error.message || "SAML test failed" }, { status: 500 });
  }
}
