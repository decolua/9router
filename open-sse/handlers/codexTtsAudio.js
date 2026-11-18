import { spawn } from "node:child_process";

export function page(packet, sequence, granule, flags) {
  const segments = Math.floor(packet.length / 255) + 1;
  if (segments > 255) throw new Error("Opus packet too large");
  const header = Buffer.alloc(27 + segments);
  header.write("OggS"); header[5] = flags; header.writeBigUInt64LE(BigInt(granule), 6);
  header.writeUInt32LE(1, 14); header.writeUInt32LE(sequence, 18); header[26] = segments;
  for (let i = 0; i < segments; i++) header[27 + i] = Math.min(255, packet.length - i * 255);
  const output = Buffer.concat([header, packet]);
  let crc = 0;
  for (const byte of output) {
    crc ^= byte << 24;
    for (let i = 0; i < 8; i++) crc = (crc & 0x80000000) ? (crc << 1) ^ 0x04c11db7 : crc << 1;
  }
  output.writeUInt32LE(crc >>> 0, 22);
  return output;
}

export function opusSamples(payload) {
  const config = payload[0] >> 3;
  const frameSamples = config < 12 ? [480, 960, 1920, 2880][config & 3]
    : config < 16 ? [480, 960][config & 1] : [120, 240, 480, 960][config & 3];
  const code = payload[0] & 3;
  const frames = code === 0 ? 1 : code === 3 ? (payload[1] & 63) : 2;
  if ((code === 3 && payload.length < 2) || !frames || frames * frameSamples > 5760) throw new Error("Invalid Opus duration");
  return frames * frameSamples;
}

export function trimCodexWav(wav, start) {
  let end = wav.length - ((wav.length - start) % 2);
  let lastSound = end;
  while (lastSound > start && Math.abs(wav.readInt16LE(lastSound - 2)) <= 64) lastSound -= 2;
  if (lastSound !== start) end = Math.min(end, lastSound + 24000 * 2 / 4);
  const trimmed = wav.subarray(0, end);
  trimmed.writeUInt32LE(trimmed.length - 8, 4);
  trimmed.writeUInt32LE(trimmed.length - start, start - 4);
  return trimmed;
}

export function codexWavToMp3(wav, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", ["-nostdin", "-hide_banner", "-loglevel", "error", "-f", "wav", "-i", "pipe:0", "-f", "mp3", "pipe:1"],
      { stdio: ["pipe", "pipe", "ignore"], signal, timeout: 15000, killSignal: "SIGKILL" });
    const chunks = []; let size = 0; let overflow = false;
    child.stdin.on("error", () => {});
    child.stdout.on("data", (chunk) => { size += chunk.length; if (size > 6 * 1024 * 1024) { overflow = true; child.kill("SIGKILL"); } else chunks.push(chunk); });
    child.on("error", () => reject(new Error("Codex MP3 encoder unavailable or cancelled")));
    child.on("close", (code) => code === 0 && size && !overflow ? resolve(Buffer.concat(chunks, size)) : reject(new Error("Codex MP3 encoding failed")));
    child.stdin.end(wav);
  });
}

// ponytail: finite contiguous Opus only; add packet-loss concealment for streaming.
export async function decodeCodexAudio(packets, signal) {
  if (!Array.isArray(packets) || !packets.length || packets.length > 12000) throw new Error("Missing Codex audio");
  let totalBytes = 0;
  for (const packet of packets) {
    if (!Buffer.isBuffer(packet.payload) || !packet.payload.length || packet.payload.length > 65024 || !Number.isInteger(packet.timestamp) || packet.timestamp < 0 || packet.timestamp > 0xffffffff) throw new Error("Invalid Opus packet");
    totalBytes += packet.payload.length;
    if (totalBytes > 16 * 1024 * 1024) throw new Error("Codex audio exceeds decode limit");
  }
  const head = Buffer.alloc(19); head.write("OpusHead"); head[8] = 1; head[9] = 2; head.writeUInt32LE(48000, 12);
  const tags = Buffer.alloc(16); tags.write("OpusTags");
  const pages = [page(head, 0, 0, 2), page(tags, 1, 0, 0)];
  let granule = 0;
  for (let i = 0; i < packets.length; i++) {
    const packet = packets[i];
    if (i) {
      const delta = (packet.timestamp - packets[i - 1].timestamp) >>> 0;
      if (delta !== opusSamples(packets[i - 1].payload)) throw new Error("Invalid Opus timestamp");
      granule += delta;
    }
    const end = granule + opusSamples(packet.payload);
    pages.push(page(packet.payload, i + 2, end, i === packets.length - 1 ? 4 : 0));
  }
  const input = Buffer.concat(pages);
  if (input.length > 20 * 1024 * 1024) throw new Error("Codex audio exceeds decode limit");
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", ["-nostdin", "-hide_banner", "-loglevel", "error", "-f", "ogg", "-i", "pipe:0", "-ac", "1", "-ar", "24000", "-f", "wav", "pipe:1"],
      { stdio: ["pipe", "pipe", "ignore"], signal, timeout: 15000, killSignal: "SIGKILL" });
    const chunks = []; let size = 0; let overflow = false;
    child.stdin.on("error", () => {});
    child.stdout.on("data", (chunk) => { size += chunk.length; if (size > 6 * 1024 * 1024) { overflow = true; child.kill("SIGKILL"); } else chunks.push(chunk); });
    child.on("error", () => reject(new Error("Codex audio decoder unavailable or cancelled")));
    child.on("close", (code) => {
      if (code !== 0 || size <= 44 || overflow) return reject(new Error("Codex audio decoding failed"));
      const wav = Buffer.concat(chunks, size);
      const data = wav.indexOf("data", 12, "ascii");
      if (data < 0 || data + 8 > wav.length) return reject(new Error("Invalid decoded WAV"));
      // ponytail: trim trailing PCM near-silence only; use voice-aware endpointing for precise boundaries.
      resolve(trimCodexWav(wav, data + 8));
    });
    child.stdin.end(input);
  });
}