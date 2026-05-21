import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSettings } from "@/lib/localDb";
import { buildCasServiceUrl, probeCasServer } from "@/lib/auth/cas";
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
    const serverUrl = String(body.serverUrl || settings.casServerUrl || "").trim();
    const validatePath = String(body.validatePath || settings.casValidatePath || "/p3/serviceValidate").trim() || "/p3/serviceValidate";

    if (!serverUrl) {
      return NextResponse.json({ error: "CAS Server URL is required" }, { status: 400 });
    }

    const serviceUrl = buildCasServiceUrl(request, "__cas_test_state__");
    const probe = await probeCasServer({ serverUrl, validatePath, serviceUrl });

    return NextResponse.json({
      ok: probe.ok,
      serverUrl,
      validatePath,
      serviceUrl,
      status: probe.status,
      message: probe.message,
      error: probe.ok ? undefined : probe.message,
    }, { status: probe.ok ? 200 : 502 });
  } catch (error) {
    return NextResponse.json({ error: error.message || "CAS test failed" }, { status: 500 });
  }
}

