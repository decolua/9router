import { NextResponse } from "next/server";
import { getProviderConnectionById, updateProviderConnection } from "@/models";

const CODEBUDDY_USAGE_URL = "https://www.codebuddy.ai/billing/meter/get-user-resource";
const CODEBUDDY_PACKAGE_CODES = [
  "TCACA_code_001_PqouKr6QWV",
  "TCACA_code_002_AkiJS3ZHF5",
  "TCACA_code_006_DbXS0lrypC",
  "TCACA_code_007_nzdH5h4Nl0",
  "TCACA_code_003_FAnt7lcmRT",
  "TCACA_code_008_cfWoLwvjU4",
  "TCACA_code_009_0XmEQc2xOf",
];

function formatDate(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function buildUsageBody() {
  const now = new Date();
  const end = new Date(now);
  end.setFullYear(end.getFullYear() + 101);

  return {
    PageNumber: 1,
    PageSize: 200,
    ProductCode: "p_tcaca",
    Status: [0, 3],
    PackageCodes: CODEBUDDY_PACKAGE_CODES,
    PackageEndTimeRangeBegin: formatDate(now),
    PackageEndTimeRangeEnd: formatDate(end),
  };
}

function normalizeCookie(cookie) {
  return String(cookie || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .join("; ");
}

async function probeCodeBuddyQuotaCookie(cookie) {
  const response = await fetch(CODEBUDDY_USAGE_URL, {
    method: "POST",
    headers: {
      Cookie: cookie,
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0",
      "X-Requested-With": "XMLHttpRequest",
      "X-Domain": "www.codebuddy.ai",
      Origin: "https://www.codebuddy.ai",
      Referer: "https://www.codebuddy.ai/profile/usage",
    },
    body: JSON.stringify(buildUsageBody()),
  });

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (response.status === 401 || response.status === 403) {
    return { ok: false, status: response.status, error: "CodeBuddy cookie is not authorized for quota usage." };
  }

  if (!response.ok) {
    return { ok: false, status: response.status, error: `CodeBuddy quota endpoint returned ${response.status}.` };
  }

  const accounts = payload?.Response?.Data?.Accounts || payload?.Accounts || payload?.data?.accounts || [];
  return {
    ok: true,
    status: response.status,
    accountCount: Array.isArray(accounts) ? accounts.length : 0,
  };
}

export async function POST(request) {
  try {
    const { cookie, connectionIds } = await request.json();
    const normalizedCookie = normalizeCookie(cookie);
    const ids = Array.isArray(connectionIds)
      ? connectionIds.map((id) => String(id || "").trim()).filter(Boolean)
      : [];

    if (!normalizedCookie) {
      return NextResponse.json({ error: "Cookie is required" }, { status: 400 });
    }

    if (ids.length === 0) {
      return NextResponse.json({ error: "Select at least one CodeBuddy connection" }, { status: 400 });
    }

    const probe = await probeCodeBuddyQuotaCookie(normalizedCookie);
    if (!probe.ok) {
      return NextResponse.json({ error: probe.error }, { status: probe.status || 400 });
    }

    let updated = 0;
    for (const id of ids) {
      const connection = await getProviderConnectionById(id);
      if (!connection || connection.provider !== "codebuddy") continue;

      await updateProviderConnection(id, {
        providerSpecificData: {
          ...(connection.providerSpecificData || {}),
          webCookie: normalizedCookie,
          webCookieCapturedAt: new Date().toISOString(),
        },
      });
      updated += 1;
    }

    if (updated === 0) {
      return NextResponse.json({ error: "No CodeBuddy connections were updated" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      updated,
      quotaRecords: probe.accountCount,
    });
  } catch (error) {
    console.error("CodeBuddy quota cookie error:", error);
    return NextResponse.json({ error: error.message || "Failed to save CodeBuddy quota cookie" }, { status: 500 });
  }
}
