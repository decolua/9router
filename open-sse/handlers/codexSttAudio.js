import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
export const MAX_AUDIO_SECONDS = 120;
const MAX_PCM_BYTES = MAX_AUDIO_SECONDS * 24000 * 2;
function failure(status, message) { return Object.assign(new Error(message), {status}); }
export async function readBounded(stream, limit, signal, oversizedStatus = 413) {
  if (!stream) throw failure(400, "Missing request body");
  const reader = stream.getReader();
  const chunks = [];
  let size = 0;
  const onAbort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    signal.throwIfAborted();
    while (true) {
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw failure(oversizedStatus, "Body exceeds size limit");
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, size);
  } finally {
    signal.removeEventListener("abort", onAbort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function convertAudio(file, signal) {
  const directory = await mkdtemp(join(tmpdir(), "9router-codex-stt-"));
  try {
    const input = join(directory, "input");
    await writeFile(input, Buffer.from(await file.arrayBuffer()), { mode: 0o600 });
    const pcm = await new Promise((resolve, reject) => {
      const child = spawn("ffmpeg", [
        "-nostdin", "-hide_banner", "-loglevel", "error", "-threads", "1",
        "-protocol_whitelist", "file,pipe", "-format_whitelist", "wav,mp3,mov,matroska,webm,ogg,flac,aac",
        "-i", input, "-map", "0:a:0", "-vn", "-t", String(MAX_AUDIO_SECONDS + 0.01),
        "-threads", "1", "-ac", "1", "-ar", "24000", "-c:a", "pcm_s16le", "-f", "s16le", "pipe:1",
      ], { stdio: ["ignore", "pipe", "ignore"], signal, timeout: 15000, killSignal: "SIGKILL" });
      const chunks = [];
      let size = 0;
      let tooLong = false;
      child.stdout.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_PCM_BYTES) { tooLong = true; child.kill("SIGKILL"); }
        else chunks.push(chunk);
      });
      child.on("error", (error) => reject(failure(error.code === "ENOENT" ? 503 : 504, error.code === "ENOENT" ? "ffmpeg is required for transcription" : "Audio conversion timed out")));
      child.on("close", (code) => {
        if (tooLong) reject(failure(400, `Audio duration exceeds ${MAX_AUDIO_SECONDS} seconds`));
        else if (code !== 0 || size === 0) reject(failure(400, "Invalid or unsupported audio"));
        else resolve(Buffer.concat(chunks, size));
      });
    });
    const wav = Buffer.alloc(44 + pcm.length);
    wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(24000, 24); wav.writeUInt32LE(48000, 28); wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(pcm.length, 40); pcm.copy(wav, 44);
    return new Blob([wav], { type: "audio/wav" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
