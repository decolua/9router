---
name: 9router-stt
description: Speech-to-text via 9Router /v1/audio/transcriptions using OpenAI Whisper / Groq / Gemini / Deepgram / AssemblyAI / NVIDIA / HuggingFace models. Use when the user wants to transcribe audio, convert speech to text, or get subtitles from audio files.
---

# 9Router — Speech-to-Text

Requires `NINEROUTER_URL` (and `NINEROUTER_KEY` if auth enabled). See https://raw.githubusercontent.com/decolua/9router/refs/heads/master/skills/9router/SKILL.md for setup.

## Discover

```bash
curl $NINEROUTER_URL/v1/models/stt | jq '.data[].id'
# Per-model params (language, response_format, prompt, temperature support)
curl "$NINEROUTER_URL/v1/models/info?id=openai/whisper-1"
```

`model` = STT model ID (e.g. `openai/whisper-1`, `groq/whisper-large-v3`, `deepgram/nova-3`, `gemini/gemini-2.5-flash`).

## Endpoint

`POST $NINEROUTER_URL/v1/audio/transcriptions` (OpenAI Whisper compatible, `multipart/form-data`)

| Field | Required | Notes |
|---|---|---|
| `model` | yes | from `/v1/models/stt` |
| `file` | yes | audio file (mp3, wav, m4a, webm, ogg, flac) |
| `language` | no | ISO-639-1 (e.g. `en`, `vi`) |
| `prompt` | no | hint text to guide transcription |
| `response_format` | no | `json` (default) / `text` / `verbose_json` / `srt` / `vtt` |
| `temperature` | no | 0–1 |

## Examples

```bash
curl -X POST "$NINEROUTER_URL/v1/audio/transcriptions" \
  -H "Authorization: Bearer $NINEROUTER_KEY" \
  -F "model=openai/whisper-1" \
  -F "file=@audio.mp3" \
  -F "language=vi"
```

JS (Node):

```js
import { createReadStream } from "node:fs";
const form = new FormData();
form.append("model", "groq/whisper-large-v3-turbo");
form.append("file", new Blob([await (await import("node:fs/promises")).readFile("audio.mp3")]), "audio.mp3");
const r = await fetch(`${process.env.NINEROUTER_URL}/v1/audio/transcriptions`, {
  method: "POST",
  headers: { "Authorization": `Bearer ${process.env.NINEROUTER_KEY}` },
  body: form,
});
const { text } = await r.json();
console.log(text);
```

## Response shape

Default (`response_format=json`):
```json
{ "text": "Xin chào, đây là bản ghi âm." }
```

`verbose_json` adds `language`, `duration`, `segments[]` with timestamps.
`srt` / `vtt` return subtitle text.

## Provider quirks

| Provider | `model` format | Notes |
|---|---|---|
| `openai` | `whisper-1`, `gpt-4o-transcribe`, `gpt-4o-mini-transcribe` | Native OpenAI shape |
| `groq` | `whisper-large-v3`, `whisper-large-v3-turbo`, `distil-whisper-large-v3-en` | Fastest; OpenAI shape |
| `gemini` | `gemini-2.5-flash`, `gemini-2.5-pro`, `gemini-2.5-flash-lite` | Server converts to `generateContent` with audio inline |
| `deepgram` | `nova-3`, `nova-2`, `whisper-large` | Token auth; server adapts response |
| `assemblyai` | `universal-3-pro`, `universal-2` | Async upload+poll handled server-side |
| `nvidia` | `nvidia/parakeet-ctc-1.1b-asr` | NIM endpoint |
| `huggingface` | `openai/whisper-large-v3`, `openai/whisper-small` | HF Inference API |
