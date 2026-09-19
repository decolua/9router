# HITL: one Client chat → Render log capture (probe 1)

Goal: falsify whether **service-initiated** outbound is a fat Router→Provider POST (chat) vs background jobs.

## Steps

1. Open Render → service **9router** → **Logs** (live).
2. Clear/scroll to a fresh timestamp; note clock time.
3. From **one** Client, send **one** short chat that forces a tool_result if possible (e.g. ask the agent to `ls` or read one small file). Prefer a single turn.
4. Stop. Do not send more chats.
5. In Logs, copy lines from ~2s before the request until the stream ends.

## Paste back (redact secrets)

Keep: timestamps, method/path, status codes, byte sizes, `content-length`, durations, provider names, `TOKEN` / refresh / sync lines.
Replace with `<REDACTED>`: API keys, JWTs, cookies, Authorization headers, tokens in URLs, account emails.

Ideal signal lines look like:

- incoming `POST /v1/chat/completions` (or `/v1/messages`, etc.)
- upstream fetch to a Provider host + status
- any `content-length` / body size / `[RTK] saved …B`
- any refresh/sync/ping **without** a matching Client request

## Verdict rules

| What logs show | Conclusion |
|----------------|------------|
| One Client turn → one large upstream POST (~100KB–MB) | Chat forwarding drives service-initiated |
| Client turn small, but many outbound calls with no Client | Background (refresh/quota/sync) drives burn |
| Deploy/build noise only, no chat | Deploys, not runtime chat |

When done, paste the redacted log slice into chat.
