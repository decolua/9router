# Pull Request: feat(antigravity): native Cloud Code Assist onboarding, schema normalization, and DoH DNS fallback

## Summary
Fixes #1138 and #1356.

Resolves critical failures when routing LLM requests from agent harnesses (Claude Code, Cursor, Cline, Hermes) to Google Antigravity / Cloud Code Assist via 9Router:
1. **Missing Cloud Code Assist Handshake & Onboarding**: Automatically queries `loadCodeAssist` on `daily-cloudcode-pa.googleapis.com` and provisions eligible accounts to `free-tier` via `onboardUser` with operation polling.
2. **Tool Schema Rejections (400 INVALID_ARGUMENT)**: Sanitizes incoming client tool parameters (`normalizeSchemaForCCA`) by stripping unsupported constraints (`$comment`, `default`, `readOnly`, `writeOnly`, `additionalProperties`), collapsing conflicting `anyOf`/`oneOf` union types, and guaranteeing explicit `properties: {}`.
3. **Envelope Schema Compliance**: Fixed protobuf field violation error (`Unknown name "sessionId": Cannot find field`) by strictly scoping `sessionId` within `request.sessionId` rather than the top-level envelope. Populated required agent trajectory labels (`trajectory_id`, `last_step_index`, `used_claude`).
4. **DNS Port 53 UDP Timeout Fallback**: In networks/ISPs where UDP port 53 to `8.8.8.8` is blocked, queries were hanging for 30 seconds (`queryA ETIMEOUT`) and getting aborted. Added fast non-loopback system DNS check and DNS-over-HTTPS (DoH via `1.1.1.1` and `dns.google` on port 443) fallback.

---

## Key Changes

### 1. Cloud Code Assist Handshake & Project Provisioning
- **Files**: `src/lib/oauth/services/antigravity.js`, `src/lib/oauth/providers/antigravity.js`, `open-sse/services/projectId.js`
- Calls `POST https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist` with headers `User-Agent: antigravity` and `{ "metadata": { "ideType": "ANTIGRAVITY" } }`.
- If `currentTier` is missing, triggers `POST https://daily-cloudcode-pa.googleapis.com/v1internal:onboardUser` with `{ "tierId": "free-tier", "metadata": { "ideType": "ANTIGRAVITY" } }` and polls operation until `done === true`.
- Re-queries `loadCodeAssist` to acquire the provisioned `cloudaicompanionProject` ID and persists it.
- In `src/sse/services/tokenRefresh.js`, preserves existing `projectId` across token refresh cycles without re-triggering onboarding.

### 2. Tool Calling Schema Normalizer (`normalizeSchemaForCCA`)
- **Files**: `src/lib/schemas/antigravity.js`, `src/lib/schemas/antigravity.ts`
- Strips keywords rejected by Google CCA: `$comment`, `readOnly`, `writeOnly`, `deprecated`, `default`, `additionalProperties`, `patternProperties`, `propertyNames`, `minLength`, `maxLength`, etc.
- Coerces boolean subschemas (`true` -> `{}`, `false` -> `{ not: {} }`).
- Collapses union types (`anyOf`, `oneOf`, `type: ["string", "null"]`) into scalar or primary types to prevent Google API `400 INVALID_ARGUMENT` rejections.
- Guarantees every object schema contains an explicit `properties: {}` dictionary.
- Integrated into `open-sse/translator/formats/gemini.js` (`cleanJSONSchemaForAntigravity`), `open-sse/translator/request/openai-to-gemini.js`, and `open-sse/executors/antigravity.js`.

### 3. Request Envelope & Endpoint Failover
- **Files**: `open-sse/executors/antigravity.js`, `open-sse/providers/registry/antigravity.js`
- Added primary and automatic sandbox failover URLs:
  - Primary: `https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse`
  - Failover: `https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:streamGenerateContent?alt=sse`
- Fixed envelope fields: strictly sets `request.sessionId`, omits root `sessionId`, populates `request.labels` (`trajectory_id`, `last_step_index`, `used_claude`), normalizes `systemInstruction.role = "user"`, and clamps `maxOutputTokens` to 8192.

### 4. DoH DNS Fallback
- **File**: `open-sse/utils/proxyFetch.js`
- Eliminates 30-second `queryA ETIMEOUT` hangs on restricted networks by checking system DNS first, falling back to DoH (`1.1.1.1` / `dns.google` over HTTPS port 443), and bounding resolver timeout to 2 seconds.

---

## Verification

### 1. Unit Tests (`tests/unit/antigravity-cca-protocol.test.js`)
All 7 unit tests pass covering Claude Code tool definitions (`Bash`, `Edit`, `Grep`), boolean subschemas, union types, envelope generation, and endpoint failover:
```text
 ✓ tests/unit/antigravity-cca-protocol.test.js (7 tests)
   ✓ Antigravity CCA Protocol & Tool Schema Normalizer
     ✓ sanitizes Claude Code Bash tool schema
     ✓ sanitizes Claude Code Edit tool schema
     ✓ sanitizes Claude Code Grep tool schema with anyOf union types
     ✓ coerces boolean subschemas and guarantees explicit properties dictionary
     ✓ collapses type arrays into first non-null scalar type
     ✓ configures primary and automatic failover SSE endpoints in registry
     ✓ builds compliant Antigravity request envelope with trajectory labels and step index

Test Files: 1 passed (1)
Tests:      7 passed (7)
```

### 2. Next.js Production Build
```text
$ next build --webpack
✓ Compiled successfully in 56s
✓ Generating static pages using 19 workers (139/139)
✓ Standalone assets copied successfully
```

### 3. Live End-to-End Verification
- Connected Google Antigravity account via 9Router dashboard (`loadCodeAssist` -> `200 OK`, project provisioned).
- Routed Claude Code CLI (`ANTHROPIC_BASE_URL=http://localhost:20127/v1`) with multi-step tool calls (`Bash`, `Glob`, `Edit`).
- Confirmed zero `400 INVALID_ARGUMENT` rejections, zero DNS timeout hangs, and smooth streaming responses.
