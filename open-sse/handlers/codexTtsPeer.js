import { MediaStreamTrack, RTCPeerConnection, RtpHeader, RtpPacket } from "werift";

// ponytail: one 500-byte context append; add acknowledged chunking before accepting longer inputs.
export function sendCodexTtsText(channel, text) {
  if (typeof text !== "string" || !text.trim()) throw new Error("Codex speech text is required");
  const content = `Vocalize only the following quoted data: ${JSON.stringify(text)}`;
  if (Buffer.byteLength(content) > 500) throw new Error("Codex speech text exceeds the 500-byte context limit");
  if (channel.readyState !== "open") throw new Error("Codex channel is not open");
  channel.send(JSON.stringify({ type: "session.context.append", content: [{ type: "input_text", text: content }] }));
}

export function waitForCodexChannel(channel, signal) {
  return new Promise((resolve, reject) => {
    const cleanup = () => { states.unSubscribe(); signal.removeEventListener("abort", abort); };
    const finish = (error) => { cleanup(); if (error) reject(error); else resolve(); };
    const abort = () => finish(signal.reason || new Error("Codex TTS cancelled"));
    const states = channel.stateChange.subscribe((state) => {
      if (state === "open") finish();
      else if (state === "closed" || state === "closing") finish(new Error("Codex channel closed"));
    });
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    else if (channel.readyState === "open") finish();
    else if (["closed", "closing"].includes(channel.readyState)) finish(new Error("Codex channel closed"));
  });
}

// ponytail: reject packet loss rather than conceal it; add jitter buffering and PLC for streaming playback.
export function orderCodexAudioPackets(packets) {
  if (!packets.length) return [];
  const sorted = [...packets].sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  let start = 0;
  let largestGap = 0;
  for (let i = 0; i < sorted.length; i++) {
    const gap = (sorted[(i + 1) % sorted.length].sequenceNumber - sorted[i].sequenceNumber + 65536) % 65536;
    if (gap > largestGap) { largestGap = gap; start = (i + 1) % sorted.length; }
  }
  sorted.push(...sorted.splice(0, start));
  const result = [sorted[0]];
  for (const packet of sorted.slice(1)) {
    const previous = result[result.length - 1];
    if (packet.sequenceNumber === previous.sequenceNumber) continue;
    if (packet.sequenceNumber !== ((previous.sequenceNumber + 1) & 65535)) throw new Error("Codex audio packet loss");
    result.push(packet);
  }
  return result;
}

// ponytail: one bounded turn; correlate turn identifiers before supporting session reuse.
export function waitForCodexTtsTurn(channel, signal, onUsage) {
  return new Promise((resolve, reject) => {
    let started = false;
    let finished = false;
    const cleanup = () => {
      messages.unSubscribe();
      states.unSubscribe();
      signal.removeEventListener("abort", abort);
    };
    const finish = (error) => {
      if (finished) return;
      finished = true;
      cleanup();
      if (error) reject(error); else resolve();
    };
    const abort = () => finish(signal.reason || new Error("Codex TTS cancelled"));
    const messages = channel.onMessage.subscribe((raw) => {
      if (Buffer.byteLength(raw) > 65536) return finish(new Error("Codex event exceeds limit"));
      let event;
      try { event = JSON.parse(raw.toString()); } catch { return finish(new Error("Invalid Codex event")); }
      if (!event || typeof event !== "object" || Array.isArray(event)) return finish(new Error("Invalid Codex event"));
      if (event.response?.usage) onUsage?.(event.response.usage);
      if (event.type === "error" || event.type === "response.cancelled" || (event.type === "response.done" && ["failed", "cancelled", "canceled", "incomplete"].includes(event.response?.status))) return finish(new Error("Codex speech turn failed"));
      if (event.type === "turn.created" || event.type === "response.created") started = true;
      // Audio is carried separately from control events; callers must drain the media track after completion.
      if (started && (event.type === "turn.done" || event.type === "response.done")) finish();
    });
    const states = channel.stateChange.subscribe((state) => {
      if (state === "closed" || state === "closing") finish(new Error("Codex channel closed"));
    });
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    else if (channel.readyState === "closed" || channel.readyState === "closing") finish(new Error("Codex channel closed"));
  });
}

// ponytail: bounded RTP capture only; add jitter buffering and Opus decoding before routing TTS.
export async function createCodexTtsPeer() {
  const peer = new RTCPeerConnection({ iceServers: [] });
  const track = new MediaStreamTrack({ kind: "audio" });
  peer.addTrack(track);
  const channel = peer.createDataChannel("oai-events");
  let sequenceNumber = 0;
  let timestamp = 0;
  let timer;
  let audioBytes = 0;
  let audioOverflow = false;
  let lastAudioAt = 0;
  const audioPackets = [];
  peer.onTrack.subscribe((remote) => {
    if (remote.kind !== "audio") return;
    remote.onReceiveRtp.subscribe((packet) => {
      if (audioOverflow) return;
      lastAudioAt = Date.now();
      audioBytes += packet.payload.length;
      if (audioBytes > 16 * 1024 * 1024 || audioPackets.length >= 12000) {
        audioOverflow = true;
        audioPackets.length = 0;
        return;
      }
      audioPackets.push({ sequenceNumber: packet.header.sequenceNumber, timestamp: packet.header.timestamp, payload: Buffer.from(packet.payload) });
    });
  });
  const startAudio = () => {
    if (timer) return;
    timer = setInterval(() => {
      track.writeRtp(new RtpPacket(new RtpHeader({ sequenceNumber, timestamp }), Buffer.from([0xf8, 0xff, 0xfe])));
      sequenceNumber = (sequenceNumber + 1) & 0xffff;
      timestamp = (timestamp + 960) >>> 0;
    }, 20);
    timer.unref();
  };
  const close = async () => {
    clearInterval(timer);
    track.stop();
    await peer.close();
  };
  try {
    await peer.setLocalDescription(await peer.createOffer());
    return { peer, channel, sdp: peer.localDescription.sdp, startAudio, close,
      // ponytail: quiet-period heuristic; use a verified media completion boundary when available.
      async drainAudio(signal) {
        const deadline = Date.now() + 2000;
        while (Date.now() < deadline) {
          signal.throwIfAborted();
          if (lastAudioAt && Date.now() - lastAudioAt >= 300) return;
          await new Promise((resolve, reject) => {
            const onAbort = () => { clearTimeout(timeout); reject(signal.reason); };
            const timeout = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, 50);
            signal.addEventListener("abort", onAbort, { once: true });
            if (signal.aborted) { signal.removeEventListener("abort", onAbort); onAbort(); }
          });
        }
        // ponytail: realtime can send continuous silence; decode the bounded tail after completion.
        if (audioPackets.length && !audioOverflow) return;
        throw new Error(`Codex audio did not drain (packets: ${audioPackets.length}, overflow: ${audioOverflow})`);
      },
      getAudioPackets() {
        if (audioOverflow) throw new Error("Codex audio exceeds capture limit");
        return orderCodexAudioPackets(audioPackets);
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}