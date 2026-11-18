import { MediaStreamTrack, RTCPeerConnection, RtpHeader, RtpPacket } from "werift";
import { createCodexTtsCall } from "./codexTtsCall.js";
import { waitForCodexChannel } from "./codexTtsPeer.js";

let active = 0;
// ponytail: validate packet duration, not Opus decoding; add a decoder if payload validation is required.
function is20msOpus(payload) {
  if (payload.length < 2) return false;
  const config = payload[0] >> 3;
  const duration = config < 12 ? [10, 20, 40, 60][config & 3] : config < 16 ? [10, 20][config & 1] : [2.5, 5, 10, 20][config & 3];
  const code = payload[0] & 3;
  const frames = code === 0 ? 1 : code === 3 ? payload[1] & 63 : 2;
  return frames > 0 && duration * frames === 20;
}
// Internal only: Opus RTP in and out; callers own framing and playback.
export async function createCodexRealtimeBridge({ credentials, voice, signal, proxyOptions, createPeer = () => new RTCPeerConnection({ iceServers: [] }), createTrack = () => new MediaStreamTrack({ kind: "audio" }), call = createCodexTtsCall }) {
  if (["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"].some((key) => process.env[key]?.trim()) || (proxyOptions && (proxyOptions.enabled || proxyOptions.connectionProxyEnabled || proxyOptions.strictProxy || proxyOptions.vercelRelayUrl || proxyOptions.url || proxyOptions.connectionProxyUrl || proxyOptions.proxyPoolId || proxyOptions.source === "error"))) throw new Error("Codex realtime media cannot use a proxy");
  const lifetime = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(90000)]);
  lifetime.throwIfAborted();
  if (active >= 2) throw Object.assign(new Error("Codex realtime capacity reached"), { status: 503 });
  const peer = createPeer();
  active++;
  let track, channel, controller, eventController, closed = false, sequenceNumber = 0, timestamp = 0, budget = 50, lastSent = Date.now();
  let closePromise;
  const shutdown = new AbortController();
  const setupSignal = AbortSignal.any([lifetime, shutdown.signal]);
  const subscriptions = [];
  const close = (error, cancelled) => {
    if (closePromise) return closePromise;
    closed = true;
    shutdown.abort(error || new Error("Codex realtime bridge closed"));
    lifetime.removeEventListener("abort", abort);
    closePromise = Promise.resolve().then(() => peer.close()).finally(() => { active--; });
    for (const subscription of subscriptions) { try { subscription.unSubscribe(); } catch {} }
    for (const c of [controller, eventController]) {
      try { if (c && c !== cancelled) { if (error) c.error(error); else c.close(); } } catch {}
    }
    try { track?.stop(); } catch {}
    return closePromise;
  };
  const fail = (error) => { void close(error).catch(() => {}); };
  const abort = () => fail(lifetime.reason || new Error("Codex realtime cancelled"));
  const audio = new ReadableStream({
    start(c) { controller = c; },
    cancel() { return close(undefined, controller); },
  }, { highWaterMark: 256, size: () => 1 });
  // ponytail: buffer at most 256 events; add consumer backpressure if upstream supports it.
  const events = new ReadableStream({
    start(c) { eventController = c; },
    cancel() { return close(undefined, eventController); },
  }, { highWaterMark: 256, size: () => 1 });
  lifetime.addEventListener("abort", abort, { once: true });
  const wait = (promise) => new Promise((resolve, reject) => {
    const onAbort = () => reject(setupSignal.reason);
    if (setupSignal.aborted) return onAbort();
    setupSignal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => setupSignal.removeEventListener("abort", onAbort));
  });
  try {
    track = createTrack();
    peer.addTrack(track);
    channel = peer.createDataChannel("oai-events");
    subscriptions.push(peer.onTrack.subscribe((remote) => {
      if (remote.kind !== "audio" || closed) return;
      subscriptions.push(remote.onReceiveRtp.subscribe((packet) => {
        if (closed) return;
        if (!packet?.payload?.length || packet.payload.length > 4096 || controller.desiredSize <= 0) return fail(new Error("Codex realtime audio output exceeds limit"));
        controller.enqueue({ sequenceNumber: packet.header.sequenceNumber, timestamp: packet.header.timestamp, payload: Buffer.from(packet.payload) });
      }));
    }));
    subscriptions.push(channel.stateChange.subscribe((state) => {
      if (state === "closed" || state === "closing") fail(new Error("Codex realtime channel closed"));
    }));
    subscriptions.push(channel.onMessage.subscribe((raw) => {
      if (closed) return;
      try {
        if (Buffer.byteLength(raw) > 65536) return fail(new Error("Codex realtime event exceeds limit"));
        const event = JSON.parse(raw.toString());
        if (!event || typeof event !== "object" || Array.isArray(event) || event.type === "error") return fail(new Error("Codex realtime event failed"));
        if (eventController.desiredSize <= 0) return fail(new Error("Codex realtime event output exceeds limit"));
        eventController.enqueue(event);
      } catch { fail(new Error("Invalid Codex realtime event")); }
    }));
    const offer = await wait(peer.createOffer());
    await wait(peer.setLocalDescription(offer));
    lifetime.throwIfAborted();
    const answer = await wait(call({ sdp: peer.localDescription.sdp, voice, credentials, signal: setupSignal, proxyOptions, realtime: true }));
    lifetime.throwIfAborted();
    await wait(peer.setRemoteDescription({ type: "answer", sdp: answer.sdp }));
    await wait(waitForCodexChannel(channel, setupSignal));
    lifetime.throwIfAborted();
    return {
      audio,
      events,
      cancelResponse() {
        if (closed || channel.readyState !== "open") throw new Error("Codex realtime bridge closed");
        if (channel.bufferedAmount > 65536) throw new Error("Codex realtime channel backpressure limit");
        channel.send(JSON.stringify({ type: "response.cancel" }));
      },
      // ponytail: 20ms Opus packets only; add negotiated packet durations when needed.
      sendAudio(payload) {
        if (closed) throw new Error("Codex realtime bridge closed");
        if (!(payload instanceof Uint8Array) || payload.length > 4096 || !is20msOpus(payload)) throw new Error("Invalid Codex realtime audio packet");
        const now = Date.now();
        budget = Math.min(50, budget + Math.max(0, now - lastSent) / 20);
        lastSent = now;
        if (budget < 1) throw new Error("Codex realtime audio input exceeds rate limit");
        budget--;
        track.writeRtp(new RtpPacket(new RtpHeader({ sequenceNumber, timestamp }), Buffer.from(payload)));
        sequenceNumber = (sequenceNumber + 1) & 65535;
        timestamp = (timestamp + 960) >>> 0;
      },
      close,
    };
  } catch (error) {
    if (setupSignal.aborted) void close().catch(() => {});
    else await close().catch(() => {});
    throw error;
  }
}