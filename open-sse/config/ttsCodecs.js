// ponytail: raw PCM layouts are signed 16-bit little-endian; add other sample encodings when required.
export const PCM_RATES = [8000, 16000, 22050, 24000, 32000, 44100, 48000];
export const TTS_UPSTREAM_FORMATS = ["pcm", "wav", "mp3", ...PCM_RATES.flatMap((rate) => [1, 2].map((channels) => `pcm_${rate}_${channels}`))];

export function pcmLayout(format) {
  if (format === "pcm") return { rate: 24000, channels: 1 };
  if (!TTS_UPSTREAM_FORMATS.includes(format)) return null;
  const match = /^pcm_(\d+)_(1|2)$/.exec(format);
  return match ? { rate: Number(match[1]), channels: Number(match[2]) } : null;
}