import codex from "../providers/registry/codex.js";
import { codexHttpFetch } from "./codexStt.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { readBounded } from "./codexSttAudio.js";

// ponytail: signaling only; add media, event handling and cleanup before routing requests here.
export async function createCodexTtsCall({ sdp, voice = "cove", credentials, signal: clientSignal, proxyOptions, realtime = false }) {
  const signal = AbortSignal.any([...(clientSignal ? [clientSignal] : []), AbortSignal.timeout(60000)]);
  const account = credentials?.providerSpecificData || {};
  const accountId = account.workspaceId || account.chatgptAccountId || account.accountId;
  if (credentials?.authType !== "oauth" || typeof credentials.accessToken !== "string"
    || !/^[\x21-\x7e]+$/.test(credentials.accessToken)
    || typeof accountId !== "string" || !/^[\x21-\x7e]{1,256}$/.test(accountId)) {
    throw new Error("A valid Codex OAuth account is required");
  }
  if (typeof sdp !== "string" || !sdp.startsWith("v=0") || Buffer.byteLength(sdp) > 65536) throw new Error("Invalid SDP offer");
  if (!["arbor", "breeze", "cove", "ember", "juniper", "maple", "sol", "spruce", "vale"].includes(voice)) throw new Error("Unsupported voice");
  if (proxyOptions?.source === "error") throw new Error("Account proxy is unavailable");
  signal.throwIfAborted();
  const body = JSON.stringify({ sdp, session: {
    model: "gpt-live-1-codex",
    ...(realtime ? {} : { instructions: "Vocalize only the text supplied by the user. Do not add, remove, or change words." }),
    audio: { output: { voice } }, delegation: { type: "client", ack_filler: false },
  } });
  const response = await proxyAwareFetch(codex.realtimeCallUrl, {
    method: "POST", redirect: "error", strictTls: true, directFetch: codexHttpFetch, signal, body,
    headers: { Authorization: `Bearer ${credentials.accessToken}`, "ChatGPT-Account-Id": accountId,
      "User-Agent": codex.transport.headers["User-Agent"], "OpenAI-Alpha": "quicksilver=v2",
      "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(body)) },
  }, proxyOptions);
  if (!response.ok) {
    await response.body?.cancel();
    throw Object.assign(new Error("Codex realtime call failed"), { status: response.status });
  }
  const location = response.headers.get("location")?.split("?")[0].split("/").findLast((part) => /^rtc_[a-zA-Z0-9_-]+$/.test(part) || /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(part));
  const answer = (await readBounded(response.body, 65536, signal, 502)).toString("utf8");
  if (!location || !answer.startsWith("v=0")) throw new Error("Invalid Codex realtime response");
  return { callId: location, sdp: answer };
}