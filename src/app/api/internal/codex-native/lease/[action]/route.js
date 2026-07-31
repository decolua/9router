import {
  acquireCodexNativeLease,
  failCodexNativeLease,
  getCodexNativeLease,
  getCodexNativeMetrics,
  ingestCodexNativeQuota,
  markCodexNativeSemanticOutput,
  releaseCodexNativeLease,
  succeedCodexNativeLease,
  validateCodexNativeLeaseModel,
} from "@/lib/codexNative/pool.js";
import { sanitizeCodexNativeRequestHeaders, headersToObject } from "@/lib/codexNative/headers.js";
import { validateCodexNativeClient } from "@/lib/codexNative/clientAuth.js";
import { getInstalledCodexClientVersion } from "@/lib/codexNative/clientVersion.js";
import { getMostRecentCodexClientVersion } from "@/lib/codexNative/catalog.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

function denied(status = 403) {
  return Response.json({ error: "Codex Native lease API is process-internal" }, { status });
}

function internalRequestAllowed(request) {
  const expected = process.env.CODEX_NATIVE_INTERNAL_SECRET;
  const supplied = request.headers.get("x-9r-internal-secret");
  const peer = request.headers.get("x-9r-real-ip");
  return !!expected && supplied === expected && LOOPBACK.has(peer);
}

function requestForClientAuth(requestHeaders) {
  return new Request("http://127.0.0.1/v1/codex/responses", {
    headers: requestHeaders || {},
  });
}

export async function POST(request, context) {
  if (!internalRequestAllowed(request)) return denied();
  const { action } = await context.params;
  let payload;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (action === "acquire") {
    const clientAuth = await validateCodexNativeClient(requestForClientAuth(payload.requestHeaders));
    if (!clientAuth.ok) return denied(401);
    const installedVersion = payload.clientVersion
      ? null
      : await getInstalledCodexClientVersion();
    const clientVersion = payload.clientVersion
      || installedVersion?.version
      || await getMostRecentCodexClientVersion();
    const routed = await acquireCodexNativeLease({
      headers: payload.requestHeaders || {},
      body: payload.body || {},
      model: payload.model || null,
      transport: "ws",
      clientVersion,
      excludeConnectionIds: new Set(payload.excludeConnectionIds || []),
    });
    if (!routed.lease) {
      return Response.json({
        error: "No WebSocket-capable Codex account is available",
        skippedReasons: routed.skippedReasons,
      }, { status: 503 });
    }
    const { lease } = routed;
    const upstreamHeaders = sanitizeCodexNativeRequestHeaders(
      payload.requestHeaders || {},
      lease.credentials
    );
    return Response.json({
      leaseId: lease.id,
      connectionId: lease.connectionId,
      upstreamHeaders: headersToObject(upstreamHeaders),
      proxy: {
        enabled: lease.proxy.connectionProxyEnabled === true,
        url: lease.proxy.connectionProxyUrl || "",
        noProxy: lease.proxy.connectionNoProxy || "",
        strict: lease.proxy.strictProxy === true,
      },
    });
  }

  const lease = getCodexNativeLease(payload.leaseId);
  if (!lease) return Response.json({ error: "Unknown or expired lease" }, { status: 404 });

  if (action === "validate-model") {
    const valid = await validateCodexNativeLeaseModel(payload.leaseId, payload.model);
    return Response.json({ valid }, { status: valid ? 200 : 409 });
  }
  if (action === "quota-event") {
    ingestCodexNativeQuota(lease.connectionId, payload.event, "websocket");
    return Response.json({ success: true });
  }
  if (action === "semantic-output") {
    markCodexNativeSemanticOutput(payload.leaseId);
    return Response.json({ success: true });
  }
  if (action === "success") {
    await succeedCodexNativeLease(payload.leaseId);
    return Response.json({ success: true });
  }
  if (action === "failure") {
    await failCodexNativeLease(payload.leaseId, {
      status: payload.status,
      error: payload.error,
    });
    return Response.json({ success: true });
  }
  if (action === "release") {
    releaseCodexNativeLease(payload.leaseId);
    return Response.json({ success: true });
  }
  return Response.json({ error: "Unknown lease action" }, { status: 404 });
}

export async function GET(request) {
  if (!internalRequestAllowed(request)) return denied();
  return Response.json(getCodexNativeMetrics());
}
