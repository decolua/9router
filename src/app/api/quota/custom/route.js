import { NextResponse } from "next/server";
import { getProviderConnectionById, getSettings, updateSettings } from "@/lib/localDb";
import { CUSTOM_QUOTA_SETTINGS_KEY, validateCustomQuotaConfig } from "@/lib/customQuota";

async function readSources() {
  const settings = await getSettings();
  const sources = settings?.[CUSTOM_QUOTA_SETTINGS_KEY];
  return sources && typeof sources === "object" && !Array.isArray(sources) ? sources : {};
}

// GET /api/quota/custom?connectionId=... — one source, or all when omitted.
export async function GET(request) {
  const connectionId = new URL(request.url).searchParams.get("connectionId");
  const sources = await readSources();

  if (connectionId) {
    return NextResponse.json({ connectionId, config: sources[connectionId] || null });
  }
  return NextResponse.json({ configs: sources });
}

// PUT /api/quota/custom — { connectionId, config }
export async function PUT(request) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const connectionId = payload?.connectionId;
  const config = payload?.config;
  if (!connectionId || typeof connectionId !== "string") {
    return NextResponse.json({ error: "connectionId is required" }, { status: 400 });
  }

  const connection = await getProviderConnectionById(connectionId);
  if (!connection) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }

  const errors = validateCustomQuotaConfig(config);
  if (errors.length > 0) {
    return NextResponse.json({ error: errors.join(" "), errors }, { status: 400 });
  }

  const sources = await readSources();
  sources[connectionId] = {
    ...config,
    enabled: config.enabled !== false,
    request: { ...config.request, method: String(config.request?.method || "GET").toUpperCase() },
    updatedAt: new Date().toISOString(),
  };
  await updateSettings({ [CUSTOM_QUOTA_SETTINGS_KEY]: sources });

  return NextResponse.json({ connectionId, config: sources[connectionId] });
}

// DELETE /api/quota/custom?connectionId=...
export async function DELETE(request) {
  const connectionId = new URL(request.url).searchParams.get("connectionId");
  if (!connectionId) {
    return NextResponse.json({ error: "connectionId is required" }, { status: 400 });
  }

  const sources = await readSources();
  delete sources[connectionId];
  await updateSettings({ [CUSTOM_QUOTA_SETTINGS_KEY]: sources });

  return NextResponse.json({ connectionId, deleted: true });
}
