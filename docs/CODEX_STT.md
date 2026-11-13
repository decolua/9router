# Codex OAuth transcription

Connect a Codex OAuth account under **Providers → OpenAI Codex**. Speech To Text → OpenAI Codex reuses those connections; an OpenAI API key is not a substitute.

```sh
curl http://localhost:20128/v1/audio/transcriptions \
  -H "Authorization: Bearer YOUR_9ROUTER_KEY" \
  -F "model=cx/transcribe" \
  -F "file=@audio.wav" \
  -F "response_format=json"
```

The equivalent full provider name is `codex/transcribe`. Responses are either `{"text":"..."}` (default `json`) or plain `text`. There are no timestamps, language selection, prompt, temperature, subtitle or verbose JSON options.

Install `ffmpeg` on the server (included in the Docker runner). Audio is converted locally into mono 24 kHz PCM16 WAV, then uploaded as a file-only multipart request to ChatGPT's internal `/backend-api/transcribe` endpoint. Limits are 25 MiB input, 120 seconds decoded audio, two concurrent conversions/transcriptions per process, 15 seconds conversion and 60 seconds per upstream attempt. Private temporary input files are deleted on both success and failure. Conversion disables network protocols and constrains ffmpeg to common audio containers.

OAuth refresh uses the existing persisted Codex credential service; a 401 may trigger one forced refresh/retry. Normal account fallback, gateway API-key/model access checks, relay/proxy selection, environment NO_PROXY and strict-proxy behavior remain in effect. Direct requests use Node HTTPS HTTP/1 with normal certificate verification; proxied/relay requests retain the shared transport. TLS verification is never relaxed by this adapter. A proxy's native fetch transport can still be refused by the upstream service; no fingerprint spoofing or insecure retry is attempted.

**Risk:** this is an internal, undocumented ChatGPT service, not the supported OpenAI audio API. Availability, account eligibility and behavior can change without notice. Audio leaves the server for the selected ChatGPT account; use only with appropriate consent. Do not expose a gateway without authentication. Like other existing STT providers, multipart parsing happens in the shared entry handler before the provider-specific file limit is checked; use an ingress upload limit for internet-facing deployments.
