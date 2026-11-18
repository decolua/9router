import { spawn } from "node:child_process";
import { page, opusSamples } from "./codexTtsAudio.js";

// ponytail: ordered, contiguous RTP only; add a jitter buffer and loss concealment for lossy networks.
export function wrapCodexRealtimePcm(bridge) {
  const encoder = spawn("ffmpeg", ["-nostdin", "-hide_banner", "-loglevel", "error", "-f", "s16le", "-ar", "24000", "-ac", "1", "-i", "pipe:0", "-c:a", "libopus", "-frame_duration", "20", "-flush_packets", "1", "-page_duration", "20000", "-f", "ogg", "pipe:1"], { stdio: ["pipe", "pipe", "ignore"] });
  const decoder = spawn("ffmpeg", ["-nostdin", "-hide_banner", "-loglevel", "error", "-probesize", "32", "-analyzeduration", "0", "-f", "ogg", "-i", "pipe:0", "-ac", "1", "-ar", "24000", "-flush_packets", "1", "-f", "s16le", "pipe:1"], { stdio: ["pipe", "pipe", "ignore"] });
  let closed = false, controller, pending = Buffer.alloc(0), packet = Buffer.alloc(0), remainder = Buffer.alloc(0), sequence = 2, granule = 0, previous, lastSequence, budget = 48000, lastInput = Date.now();
  const reader = bridge.audio.getReader();
  let closePromise;
  const close = (error, cancelled = false) => {
    if (closePromise) return closePromise;
    closed = true;
    for (const child of [encoder, decoder]) { child.stdin.destroy(); child.stdout.destroy(); child.kill("SIGKILL"); }
    if (!cancelled) { try { if (error) controller.error(error); else controller.close(); } catch {} }
    closePromise = Promise.allSettled([reader.cancel(), bridge.close()]).then(() => {});
    return closePromise;
  };
  const fail = (error) => { void close(error).catch(() => {}); };
  const audio = new ReadableStream({ start(c) { controller = c; }, cancel() { return close(undefined, true); } }, { highWaterMark: 64 });
  for (const child of [encoder, decoder]) {
    child.on("error", fail);
    child.stdin.on("error", fail);
    child.stdout.on("error", fail);
    child.on("close", () => { if (!closed) fail(new Error("Codex PCM codec stopped")); });
  }
  const write = (child, data) => {
    if (closed || child.stdin.destroyed || child.stdin.writableLength + data.length > 65536) throw new Error("Codex PCM codec backpressure limit");
    child.stdin.write(data);
  };
  const head = Buffer.alloc(19); head.write("OpusHead"); head[8] = 1; head[9] = 2; head.writeUInt32LE(48000, 12);
  const tags = Buffer.alloc(16); tags.write("OpusTags");
  write(decoder, page(head, 0, 0, 2));
  write(decoder, page(tags, 1, 0, 0));
  encoder.stdout.on("data", (chunk) => {
    try {
      pending = Buffer.concat([pending, chunk]);
      if (pending.length > 131072) throw new Error("Codex PCM encoder output exceeds limit");
      while (pending.length >= 27) {
        if (pending.toString("ascii", 0, 4) !== "OggS") throw new Error("Invalid encoder output");
        const count = pending[26];
        if (pending.length < 27 + count) break;
        let size = 0; for (let i = 0; i < count; i++) size += pending[27 + i];
        if (pending.length < 27 + count + size) break;
        let offset = 27 + count;
        for (let i = 0; i < count; i++) {
          const length = pending[27 + i];
          packet = Buffer.concat([packet, pending.subarray(offset, offset + length)]); offset += length;
          if (packet.length > 4096) throw new Error("Encoded Opus packet exceeds limit");
          if (length < 255) {
            if (!packet.subarray(0, 8).equals(Buffer.from("OpusHead")) && !packet.subarray(0, 8).equals(Buffer.from("OpusTags"))) bridge.sendAudio(packet);
            packet = Buffer.alloc(0);
          }
        }
        pending = pending.subarray(offset);
      }
    } catch (error) { fail(error); }
  });
  decoder.stdout.on("data", (chunk) => {
    try {
      const data = remainder.length ? Buffer.concat([remainder, chunk]) : chunk;
      const length = data.length - data.length % 2;
      remainder = data.subarray(length);
      if (length) {
        if (controller.desiredSize <= 0) throw new Error("Codex PCM output exceeds limit");
        controller.enqueue(data.subarray(0, length));
      }
    }
    catch (error) { fail(error); }
  });
  void (async () => {
    try {
      while (!closed) {
        const { value, done } = await reader.read();
        if (done) break;
        const samples = opusSamples(value.payload);
        if (previous !== undefined && (((value.timestamp - previous.timestamp) >>> 0) !== previous.samples || ((value.sequenceNumber - lastSequence) & 65535) !== 1)) throw new Error("Codex RTP loss or reordering");
        granule += samples;
        write(decoder, page(value.payload, sequence++, granule, 0));
        previous = { timestamp: value.timestamp, samples }; lastSequence = value.sequenceNumber;
      }
      if (!closed) fail(new Error("Codex audio stream ended"));
    } catch (error) { fail(error); }
  })();
  return {
    audio, events: bridge.events,
    cancelResponse: () => bridge.cancelResponse(),
    sendAudio(payload) {
      if (!(payload instanceof Uint8Array) || !payload.length || payload.length > 3840 || payload.length % 2) throw new Error("Invalid PCM16 audio");
      const now = Date.now();
      budget = Math.min(48000, budget + Math.max(0, now - lastInput) * 48); lastInput = now;
      if (payload.length > budget) throw new Error("Codex PCM input exceeds rate limit");
      budget -= payload.length;
      write(encoder, payload);
    },
    close,
  };
}