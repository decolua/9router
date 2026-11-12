# 9Router Dogfood Integration Report — 2026-09-25 — Multimodal Surface (image / TTS / STT / search / web-fetch)

**Verdict: DOES-NOT-DELIVER (fresh install) / SHIPPABLE (older deployed instances) — the split verdict itself is the headline.**

## Promise under test

"This fork of 9router routes OpenAI-style requests to 40+ providers and 100+ models,
including the non-chat modalities: image generation (`/v1/images/generations`), TTS
(`/v1/audio/speech`), STT (`/v1/audio/transcriptions`), web search (`/v1/search`) and
web fetch (`/v1/web/fetch`), each discoverable via `/v1/models*` listing endpoints."

Angle: the 13 previous dogfood runs covered CLI/ federation / UI bootstrap /
embeddings. Nobody had ever driven the multimodal endpoints as a user would.

## Method

- Scratch instance: `/home/kara/9router` at HEAD `624e042e` (federation), own
  `DATA_DIR=/tmp/dogfood-9router-mm2/data`, port 20131, `node custom-server.js`.
  Real `GEMINI_API_KEY` added via the same documented dashboard API a user uses
  (`POST /api/providers`, then mint a key via `POST /api/keys`).
- Cross-check instance: the long-running container rig on :20128 (image baked
  ~Sep 23: next 16.3.4 / undici 7.x) — same repo, older deps.
- Install leg: ephemeral bunker (las-bunker-03, agent 0b251c72, destroyed after),
  manual procedure (bunker-qa.sh `__gen-remote` is still broken — DF-9ROUTER-46).

## What happened, step by step

| # | Step | Result |
|---|------|--------|
| 1 | Boot scratch instance | Ready in ~0ms, DB migrated, 4690-model catalog loaded |
| 2 | Login, add Gemini connection, mint API key (documented API) | works, <1s each |
| 3 | `GET /v1/models/image` / `-tts` / `-stt` | all three lists correct |
| 4 | First `POST /v1/images/generations` | **502** — `Unexpected token '\u001f', "\u001f<8b>…" is not valid JSON (reset after 30s)` → account locked 30s |
| 5 | Retry, plus `POST /v1/audio/speech` | same 502 class every time |
| 6 | `POST /v1/chat/completions` | **503** `Invalid JSON response from gemini` — even chat is dead on this instance |
| 7 | Same calls on the older rig :20128 | image → 200 PNG 1024×1024 in 5–7s; TTS → 200 RIFF WAVE; chat → 200 |
| 8 | Standalone node probe of upstream + of `open-sse/utils/proxyFetch.js` outside Next | upstream 200 + transparent gzip decode in BOTH → breakage needs the Next runtime + undici 8 combination |
| 9 | Bunker install at `699edac3` (pre-bump) | install 87s, boot, chat → **200** |
| 10 | Same bunker at `624e042e` + npm install | chat → **503** (reproduced) |
| 11 | Same checkout, `npm install --no-save undici@7.19.2`, restart | chat → **200 "U7-OK"** |

Step 11 is the root-cause proof: the undici `^7.19.2 → ^8.11.0` bump (89c0084f,
"chore(deps): bump next 16.3.6 line, marked, material-symbols, undici") breaks every
Gemini upstream call at HEAD on a fresh install. Filed as **DF-9ROUTER-42 (P0)**.

## The multimodal workflow (on a working instance)

With undici 7 present (rig or undici-7 install), the full media loop works and feels good:

- **Image**: 1024×1024 PNG, cold 8.3s*, warm 5.0–6.9s. (*8.3s first call measured on
  the broken instance includes a failed attempt; working-instance cold timing ~6.1s.)
- **TTS**: `gemini-2.5-flash-preview-tts` → valid RIFF WAVE 24kHz mono PCM,
  1.4–1.6s warm, 4.0s first call.
- **STT**: the TTS-produced WAV transcribed back as
  `{"text":"Hello from Nine Router DogFood."}` in 1.3–1.9s warm.
  **Pitfall (DF-9ROUTER-43)**: posting the file without an explicit MIME type
  (`curl -F file=@x.wav`) fails with `Unsupported MIME type: application/octet-stream`
  and burns the 30s account lock; you must send `-F 'file=@x.wav;type=audio/wav'`.
- **Search**: `POST /v1/search {"provider":"gemini","query":…}` → 200 with results in
  4.0–8.6s. Field is `query` + `provider` — `model` with a `provider/model` id is
  rejected (`Unknown provider`), which contradicts the web-search skill's own example
  shape (`{"model":"tavily",...}` works only because bare provider ids resolve).
- **Web fetch**: dead for a Gemini-only user — every fetch-capable provider
  (jina-reader, tavily, exa, firecrawl) needs its own credential; Gemini has
  `searchViaChat` but no `fetchConfig`. Not a bug, but a discoverability gap:
  nothing in the docs says fetch needs a dedicated provider.

## Timing summary (Step 2b — measured, warm unless noted)

| Operation | Warm | Notes |
|---|---|---|
| chat (gemini-2.5-flash-lite, tiny) | 0.31–0.45s (n=5) | rig, streaming |
| image generation 1024² | 5.0–6.9s (n=3) | upstream-bound, fine |
| TTS short sentence | 1.4–1.6s (n=3) | |
| STT 2s WAV | 1.3–1.9s (n=3) | |
| web search | 7.0–8.6s (n=3) | grounding API latency; noticeable but acceptable |
| fresh install (bunker) | npm install 87s, dev boot <60s to first 200 | |

**Perf verdict: nothing here is slow enough that a user would notice or that a
profile would earn its keep — the pain in this run is correctness, not speed.**
No PERF rows filed; the numbers are recorded here and in the board for the record.

## Install leg (fresh machine)

- bunker-qa.sh battery: SKIPPED — `__gen-remote` renders a docker usage error instead
  of the remote script (row DF-9ROUTER-46; pre-existing FLAKE-9ROUTER-003).
- Manual ephemeral-bunker procedure instead: clone 3s → npm install 87s → dev boot
  → login → connection → key → **chat 200 at 699edac3, chat 503 at HEAD**.
  The install leg is what exposed the P0 — the deployed instances were all healthy.

## Verdict

- **Fresh install of HEAD: 🔴 DOES-NOT-DELIVER.** First chat call fails 100% of the
  time with a JSON-parse error on a gzip body, and the error path additionally locks
  the only account for 30s. Time-to-first-success: never.
- **Deployed instances with undici 7: ✅ the multimodal surface is genuinely good** —
  TTS→STT round trip returns the exact sentence, images are real, search works.
  Value is real; the release process (deps bump without a fresh-install smoke)
  broke it.

## What a new user needs that isn't documented

1. Restart required after adding a provider connection (nothing says so).
2. STT uploads need an explicit MIME type or they're rejected with a confusing error.
3. `/v1/search` wants `provider`/`query`; `/v1/web/fetch` needs a dedicated fetch
   provider credential; `/v1/models/web` returns empty without one.
4. `.env.example`'s `PORT` silently overrides expectations; port authority is spread
   across README / .env.example / package.json scripts (DF-9ROUTER-44).
