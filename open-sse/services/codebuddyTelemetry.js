import { getCodebuddyIdentity, CODEBUDDY_CLI_VERSION, CODEBUDDY_BUILD } from "../shared/codebuddyIdentity.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { dbg } from "../utils/debugLog.js";

/**
 * codebuddyTelemetry — replicates the official CodeBuddy client's telemetry so a
 * proxied key no longer appears "silent" to Tencent's ban detector.
 *
 * DESIGN RULES (fail-open, non-blocking):
 *   - Every public function swallows its own errors and NEVER rejects.
 *   - All sends are fire-and-forget from the chat path: callers use the returned
 *     promise only to attach `.catch(() => {})` / float it — telemetry must
 *     never add latency to, or change the outcome of, a chat request.
 *   - Raw secrets are never sent. Only the derived identity (qimei36,
 *     machineId, sessionId...) and the Authorization bearer the key already owns.
 *
 * Endpoints (official client):
 *   - POST https://copilot.tencent.com/v2/report          (lifecycle + chat events)
 *   - POST https://galileotelemetry.tencent.com/collect   (analytics heartbeat)
 *   - POST https://galileotelemetry.tencent.com/v1/traces (otel spans)
 *   - GET  .../aegiscontrol/whitelist?uid=..&topic=..     (aegis security whitelist)
 */

const REPORT_URL = "https://copilot.tencent.com/v2/report";
const GALILEO_COLLECT_URL = "https://galileotelemetry.tencent.com/collect";
const GALILEO_TRACES_URL = "https://galileotelemetry.tencent.com/v1/traces";
const GALILEO_AEGIS_URL = "https://galileotelemetry.tencent.com/aegiscontrol/whitelist";

// Galileo SDK topic id shared by the official CLI / WorkBuddy Desktop.
const GALILEO_TOPIC = "SDK-768de26ec97715a3bbab";

const SEND_TIMEOUT_MS = 5000; // hard cap so telemetry can never hang the pipeline

function accessTokenOf(credentials) {
  return credentials?.accessToken || credentials?.apiKey || "";
}

function userIdOf(credentials) {
  return (
    credentials?.providerSpecificData?.uid ||
    credentials?.uid ||
    credentials?.userId ||
    ""
  );
}

function authHeaders(credentials) {
  const token = accessTokenOf(credentials);
  const uid = userIdOf(credentials);
  const h = {
    "Content-Type": "application/json;charset=UTF-8",
    Accept: "application/json",
    "User-Agent": `CLI/${CODEBUDDY_CLI_VERSION} CodeBuddy/${CODEBUDDY_CLI_VERSION}`,
    "X-Product": "SaaS",
    "X-Domain": "www.codebuddy.cn",
    "X-IDE-Type": "CLI",
    "X-IDE-Name": "CLI",
    "X-IDE-Version": CODEBUDDY_CLI_VERSION,
    "x-requested-with": "XMLHttpRequest",
    "x-codebuddy-request": "1",
  };
  if (token) h["Authorization"] = `Bearer ${token}`;
  if (uid) h["X-User-Id"] = uid;
  return h;
}

// Common fields present on every /v2/report event from the official client.
function commonEventFields(credentials) {
  const id = getCodebuddyIdentity(credentials);
  const hw = id.hardware;
  const vcs = id.vcs;
  return {
    userId: userIdOf(credentials),
    product: "SaaS",
    releaseDate: CODEBUDDY_BUILD.releaseDate,
    commit: CODEBUDDY_BUILD.commit,
    extName: "workbuddy-desktop",
    extVersion: "5.3.8",
    ideName: "CLI",
    ideType: "CLI",
    ideVersion: CODEBUDDY_CLI_VERSION,
    machineId: id.machineId,
    sessionId: id.sessionId,
    qimei36: id.qimei36,
    os: hw.os,
    arch: hw.arch,
    osVersion: hw.osVersion,
    cpuModel: hw.cpuModel,
    cpuCores: hw.cpuCores,
    memorySize: hw.memorySize,
    timezone: hw.timezone,
    vcsType: vcs.vcsType,
    vcsRepo: vcs.vcsRepo,
    vcsBranchName: vcs.vcsBranchName,
    vcsRevId: vcs.vcsRevId,
  };
}

// Fire-and-forget POST with a hard timeout; always resolves (never rejects).
async function safePost(url, headers, body, proxyOptions = null) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SEND_TIMEOUT_MS);
  try {
    const res = await proxyAwareFetch(
      url,
      { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body), signal: ctrl.signal },
      proxyOptions
    );
    clearTimeout(timer);
    return res;
  } catch (e) {
    clearTimeout(timer);
    dbg("CB-TELEMETRY", `POST ${url} failed (ignored): ${e?.message || e}`);
    return null;
  }
}

async function safeGet(url, headers, proxyOptions = null) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SEND_TIMEOUT_MS);
  try {
    const res = await proxyAwareFetch(url, { method: "GET", headers, signal: ctrl.signal }, proxyOptions);
    clearTimeout(timer);
    return res;
  } catch (e) {
    clearTimeout(timer);
    dbg("CB-TELEMETRY", `GET ${url} failed (ignored): ${e?.message || e}`);
    return null;
  }
}

async function postReport(events, credentials, proxyOptions = null) {
  if (!Array.isArray(events) || events.length === 0) return;
  if (!accessTokenOf(credentials)) return; // no token → nothing to authenticate telemetry with
  await safePost(REPORT_URL, authHeaders(credentials), events, proxyOptions);
}

/**
 * Send the session-startup lifecycle events once per credential per process.
 * Subsequent calls for the same credential are no-ops (the official client only
 * emits these on startup).
 */
const _lifecycleSent = new Set();
export async function sendSessionLifecycle(credentials, proxyOptions = null) {
  try {
    const token = accessTokenOf(credentials);
    if (!token) return;
    const id = getCodebuddyIdentity(credentials);
    const dedupKey = id.machineId;
    if (_lifecycleSent.has(dedupKey)) return;
    _lifecycleSent.add(dedupKey);

    const common = commonEventFields(credentials);
    const now = Date.now();
    const events = [
      {
        eventCode: "ide_lifecycle",
        timestamp: now,
        reportDelay: 2000,
        action: "start",
        text: JSON.stringify({
          sessionId: id.sessionId,
          platform: id.hardware.os,
          arch: id.hardware.arch,
          appVersion: CODEBUDDY_CLI_VERSION,
          startedAt: now,
        }),
        ...common,
      },
      {
        eventCode: "plugin_status",
        timestamp: now,
        reportDelay: 3000,
        status: "info",
        text: "pluginStart",
        isInterval: false,
        ...common,
      },
    ];
    await postReport(events, credentials, proxyOptions);

    // Aegis security whitelist check (startup signal).
    const uid = userIdOf(credentials);
    if (uid) {
      await safeGet(`${GALILEO_AEGIS_URL}?uid=${encodeURIComponent(uid)}&topic=${GALILEO_TOPIC}`, authHeaders(credentials), proxyOptions);
    }
  } catch (e) {
    dbg("CB-TELEMETRY", `sendSessionLifecycle ignored error: ${e?.message || e}`);
  }
}

/**
 * Pre-chat telemetry: agent_task_created + chat_message_send + chat_request_send.
 * ctx: { requestId, conversationId, messageId, model, mode, inputLength, historyCount }
 */
export async function sendPreChatEvents(credentials, ctx = {}, proxyOptions = null) {
  try {
    if (!accessTokenOf(credentials)) return;
    const common = commonEventFields(credentials);
    const now = Date.now();
    const model = ctx.model || "auto";
    const events = [
      {
        eventCode: "agent_task_created",
        timestamp: now - 2000,
        reportDelay: 1000,
        name: "working",
        mode: ctx.mode || "craft",
        source: "LOCAL",
        has_repo: false,
        repo_type: "none",
        workspace_type: "empty",
        has_connector: false,
        has_expert: false,
        has_skill: false,
        requestModelName: model,
        requestModelId: ctx.modelId || model,
        conversationId: ctx.conversationId || ctx.requestId || "",
        requestId: ctx.requestId || "",
        ...common,
      },
      {
        eventCode: "chat_message_send",
        timestamp: now - 1500,
        reportDelay: 1000,
        conversationId: ctx.conversationId || ctx.requestId || "",
        requestId: ctx.requestId || "",
        messageId: ctx.messageId || "",
        requestModelId: ctx.modelId || model,
        requestModelName: model,
        historyCount: ctx.historyCount ?? 1,
        isContextTruncated: false,
        currentStepCount: 1,
        presentAt: now - 1500,
        ...common,
      },
      {
        eventCode: "chat_request_send",
        timestamp: now - 1000,
        reportDelay: 1000,
        mode: ctx.mode || "craft",
        inputLength: ctx.inputLength ?? 0,
        requestModelId: ctx.modelId || model,
        requestModelName: model,
        ...common,
      },
    ];
    await postReport(events, credentials, proxyOptions);
  } catch (e) {
    dbg("CB-TELEMETRY", `sendPreChatEvents ignored error: ${e?.message || e}`);
  }
}

/**
 * Post-chat telemetry: chat_message_response + agent_task_completed.
 * ctx: { model, modelId, inputToken, outputToken, isSuccessful, messageErrorCode,
 *        finishReason, durationMs, conversationId }
 */
export async function sendPostChatEvents(credentials, ctx = {}, proxyOptions = null) {
  try {
    if (!accessTokenOf(credentials)) return;
    const common = commonEventFields(credentials);
    const now = Date.now();
    const model = ctx.model || "auto";
    const inTok = ctx.inputToken ?? 0;
    const outTok = ctx.outputToken ?? 0;
    const events = [
      {
        eventCode: "chat_message_response",
        timestamp: now - 500,
        reportDelay: 1000,
        requestModelId: ctx.modelId || model,
        requestModelName: model,
        responseModelId: ctx.modelId || model,
        inputToken: inTok,
        outputToken: outTok,
        totalToken: inTok + outTok,
        cachedTokens: 0,
        isSuccessful: ctx.isSuccessful !== false,
        messageErrorCode: ctx.messageErrorCode || "",
        finishReason: ctx.finishReason || "stop",
        firstTokenAt: now - 400,
        presentAt: now - 500,
        ...common,
      },
      {
        eventCode: "agent_task_completed",
        timestamp: now,
        reportDelay: 1000,
        mode: "LOCAL",
        task_id: ctx.conversationId || ctx.requestId || "",
        duration_ms: ctx.durationMs ?? 0,
        total_steps: 1,
        ...common,
      },
    ];
    await postReport(events, credentials, proxyOptions);
  } catch (e) {
    dbg("CB-TELEMETRY", `sendPostChatEvents ignored error: ${e?.message || e}`);
  }
}

/** Galileo analytics heartbeat (collect). Fire-and-forget. */
export async function sendGalileoCollect(credentials, proxyOptions = null) {
  try {
    const uid = userIdOf(credentials);
    if (!uid) return;
    const id = getCodebuddyIdentity(credentials);
    const body = {
      topic: GALILEO_TOPIC,
      bean: {
        uid,
        aid: id.machineId,
        env: "production",
        platform: "windows_x64",
        netType: "wifi",
      },
      ext: JSON.stringify({
        wb_process: "main",
        wb_version: "5.3.8",
        appVersion: "5.3.8",
        wb_env: "production",
        platform: "windows_x64",
        node: "22.21.1",
        electron: "37.10.3",
        chrome: "138.0.7204.251",
        os: "windows 10.0.26200",
      }),
      scheme: "v2",
      d2: [],
      v: "2.6.13",
    };
    const headers = {
      "Content-Type": "text/plain;charset=UTF-8",
      "User-Agent": `CLI/${CODEBUDDY_CLI_VERSION} CodeBuddy/${CODEBUDDY_CLI_VERSION}`,
    };
    await safePost(GALILEO_COLLECT_URL, headers, body, proxyOptions);
  } catch (e) {
    dbg("CB-TELEMETRY", `sendGalileoCollect ignored error: ${e?.message || e}`);
  }
}

/** Galileo OpenTelemetry trace for a chat request. ctx: { durationMs }. */
export async function sendGalileoTrace(credentials, ctx = {}, proxyOptions = null) {
  try {
    const id = getCodebuddyIdentity(credentials);
    const now = Date.now();
    const durNs = (ctx.durationMs ?? 0) * 1e6;
    const endNs = BigInt(now) * 1000000n;
    const startNs = endNs - BigInt(Math.max(0, Math.floor(durNs)));
    const traceSeed = id.qimei36 + String(now);
    const traceId = (traceSeed.replace(/[^0-9a-f]/gi, "").toLowerCase() + id.qimei36).slice(0, 32).padEnd(32, "0");
    const spanId = traceId.slice(0, 16);
    const body = {
      resourceSpans: [
        {
          resource: {
            attributes: [
              { key: "service.name", value: { stringValue: "codebuddy-cli" } },
              { key: "telemetry.sdk.language", value: { stringValue: "nodejs" } },
              { key: "telemetry.sdk.name", value: { stringValue: "opentelemetry" } },
              { key: "service.version", value: { stringValue: CODEBUDDY_CLI_VERSION } },
              { key: "env_name", value: { stringValue: "production" } },
            ],
          },
          scopeSpans: [
            {
              scope: { name: "codebuddy-cli" },
              spans: [
                {
                  traceId,
                  spanId,
                  name: "wb.chat.request",
                  kind: 1,
                  startTimeUnixNano: startNs.toString(),
                  endTimeUnixNano: endNs.toString(),
                },
              ],
            },
          ],
        },
      ],
    };
    const headers = {
      "Content-Type": "application/json",
      "User-Agent": `CLI/${CODEBUDDY_CLI_VERSION} CodeBuddy/${CODEBUDDY_CLI_VERSION}`,
    };
    await safePost(GALILEO_TRACES_URL, headers, body, proxyOptions);
  } catch (e) {
    dbg("CB-TELEMETRY", `sendGalileoTrace ignored error: ${e?.message || e}`);
  }
}

export default {
  sendSessionLifecycle,
  sendPreChatEvents,
  sendPostChatEvents,
  sendGalileoCollect,
  sendGalileoTrace,
};
