import { createCodexTtsCall } from "./codexTtsCall.js";
import { createCodexTtsPeer, sendCodexTtsText, waitForCodexChannel, waitForCodexTtsTurn } from "./codexTtsPeer.js";
import { decodeCodexAudio } from "./codexTtsAudio.js";

let active = 0;
// ponytail: experimental, unrouted single-turn transport; integrate only after live protocol verification.
export async function synthesizeCodexTts({ input, voice, credentials, signal: clientSignal, proxyOptions, onUsage }) {
  if (["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"].some((key) => process.env[key]?.trim()) || (proxyOptions && (proxyOptions.enabled || proxyOptions.connectionProxyEnabled || proxyOptions.strictProxy || proxyOptions.vercelRelayUrl || proxyOptions.url || proxyOptions.connectionProxyUrl || proxyOptions.proxyPoolId || proxyOptions.source === "error"))) throw new Error("Codex realtime media cannot use a proxy");
  const signal = AbortSignal.any([...(clientSignal ? [clientSignal] : []), AbortSignal.timeout(90000)]);
  const cleanup = new AbortController();
  const turnSignal = AbortSignal.any([signal, cleanup.signal]);
  signal.throwIfAborted();
  if (active >= 2) throw Object.assign(new Error("Codex speech capacity reached"), { status: 503 });
  active++;
  let connection;
  try {
    connection = await createCodexTtsPeer();
    signal.throwIfAborted();
    const call = await createCodexTtsCall({ sdp: connection.sdp, voice, credentials, signal, proxyOptions });
    await connection.peer.setRemoteDescription({ type: "answer", sdp: call.sdp });
    await waitForCodexChannel(connection.channel, signal);
    connection.startAudio();
    const turn = waitForCodexTtsTurn(connection.channel, turnSignal, onUsage);
    try {
      sendCodexTtsText(connection.channel, input);
    } catch (error) {
      // The listener must not outlive a failed send.
      void turn.catch(() => {});
      throw error;
    }
    await turn;
    await connection.drainAudio(signal);
    return await decodeCodexAudio(connection.getAudioPackets(), signal);
  } finally {
    cleanup.abort();
    try { await connection?.close(); } finally { active--; }
  }
}