# Progressive Tool Disclosure — Design Document

**Status:** Pre-implementation design pass  
**Date:** 2026-08-26  
**Branch:** `claude/9router-tool-disclosure-design`

> **Inspired by:** Michael Rollins, "MCP is Dead," *rollins.io* (2026). <https://rollins.io/mcp-is-dead/>  
> The core structural diagnosis — that MCP tool schemas travel the prompt on every turn, producing linear token-cost growth — is Rollins'. This document proposes implementing the Agent SDK efficiency pattern he describes as a transparent proxy layer inside 9router, without abandoning MCP.

---

## 1. The Core Problem

### MCP's per-turn schema tax

Every time a Claude Code session sends a request, the full JSON schema for every available tool travels in `tools[]`. This is not a one-time cost — it recurs on every turn of the conversation, for every tool whether or not it is relevant.

Michael Rollins' ["MCP is Dead"](https://rollins.io/mcp-is-dead/) puts the structural issue plainly: "the MCP surface must travel in the prompt on every turn," creating linear token-cost growth over a session. The proposed fix there — replacing MCP with an Agent SDK's `execute_code` discovery model — frontloads the schema cost to turn 1 and then references tools by handle thereafter (constant cost).

9router's opportunity is to deliver that same efficiency gain **at the proxy layer**, without requiring any change to the MCP clients or servers. The model still gets tool schemas; it just doesn't get all of them every time.

### What 9router does today

The current pipeline (`open-sse/handlers/chatCore.js`) receives the client's `tools[]` array and passes it to the model nearly untouched:

- The last tool gets a `cache_control: { type: "ephemeral", ttl: "1h" }` annotation for prompt caching (applied in both `openai-to-claude.js:181` and `translator/formats/claude.js:430`).
- `toolDeduper.js` strips 2–5 specific overlapping tools by hardcoded rule (e.g. built-in WebSearch when Exa MCP is present).
- Non-Anthropic Claude providers drop non-`function` tool types.
- Otherwise: **every schema passes through at full fidelity, every turn, unconditionally.**

The `headroom.js` layer already measures `toolSchemaBytes` in `captureSizeSnapshot()` — so 9router is already treating tool schema size as a diagnostic signal. It just never acts on it.

### Token overhead (estimated)

| Session type | Tool count | Approx tool array | ~Tokens per turn |
|---|---|---|---|
| 1–2 MCP servers | 10–20 | 6–12 KB | 1,500–3,000 |
| 4–6 MCP servers | 30–50 | 21–35 KB | 5,000–9,000 |
| 8–12 MCP servers | 60–120 | 48–96 KB | 12,000–24,000 |

At the high end, tool schemas alone consume **10–15% of a 200k-token context** on every single turn — including turns where the model does nothing but read a file or reply to the user.

> **Uncertainty:** These are estimates from typical MCP schema sizes. No large-N fixture exists in the test suite. Measuring real session distributions (Phase 0) is the first step.

---

## 2. Two Modes, One Design

The "MCP is Dead" framing presents a binary: MCP (inefficient) vs Agent SDK (efficient). The Agent SDK's efficiency comes from **session-level tool registration** — pay the schema cost once, then reference tools by name. 9router can implement exactly that pattern as a transparent proxy layer, in two complementary modes:

| Mode | How | Analogy in 9router today |
|---|---|---|
| **Passive** (Phases 1–2) | Pre-filter `tools[]` before each request using static rules + BM25 relevance | RTK / headroom / caveman — request-body token savers wired into `chatCore.js` |
| **Active** (Phase 3) | Inject a synthetic `tool_search` tool; intercept its call; resolve schemas server-side; re-dispatch | Format translation loop — proxy resolves a model intent internally, client sees one stream |

Passive mode reduces the cost of every turn proportionally. Active mode achieves the Agent SDK's goal: the model pays the bulk schema cost only on the turns where it actually discovers new tools, and references already-known tools by name on all others.

Both modes slot into the existing `chatCore.js` lifecycle, parallel to systems already there.

---

## 3. Pipeline Insertion Point

The disclosure system — both passive and active — must run **after translation** (so it sees a normalized tool shape regardless of source format) and **before the RTK / headroom / caveman token savers**, so downstream savers operate on the already-pruned body.

```
chatCore.js request lifecycle (current → proposed)
────────────────────────────────────────────────────
1.  Format detection + passthrough / translate
2.  dedupeTools()                         ← existing overlap dedup (static rules)
──── NEW ─────────────────────────────────────────────────────────────────
3.  toolFilter()                          ← static include/exclude config (Phase 1)
4.  toolDisclose()                        ← BM25 relevance, top-K selection (Phase 2)
    └─ [active mode only] tool_search     ← synthetic tool injection (Phase 3)
──── existing ────────────────────────────────────────────────────────────
5.  RTK compress (compressMessages)
6.  Headroom compress (compressWithHeadroom)
7.  Caveman / Ponytail / Pxpipe
8.  anchorClaudeCache()
9.  Dispatch to executor
```

The insertion point is immediately after line 205 in `chatCore.js` (the end of the `dedupeTools` block). Both steps 3 and 4 are separable; step 3 can ship alone.

---

## 4. Passive Mode — Pre-Filter + BM25

### 4.1 Static filter (`toolFilter`)

Runs first. Evaluates each tool against a declarative config and removes tools that should never reach the model, before they enter the session index. Analogous to `dedupeTools()` but config-driven rather than hardcoded.

### 4.2 Session-level index

On the **first turn** of a connection (`connectionId`):
1. Hash the post-filter tool name set → `toolSetId`.
2. Build a BM25 index over all tools: name + description + parameter names concatenated.
3. Cache the index by `connectionId`. Persist across turns.

On **subsequent turns**: if the tool name set is unchanged (same `toolSetId`), reuse the cached index. If it changes (MCP servers added/removed mid-session), rebuild.

This is the session-level registration analog: the schema is read once, indexed once, and referenced cheaply thereafter. The per-turn cost is only the BM25 query (microseconds), not re-parsing all schemas.

### 4.3 Per-turn BM25 query

The query is the **content of the user's last message** (extracted from `body.messages` at the final human turn). Score all indexed tools; keep the top-K by score.

**Always-include exceptions** (never filtered):
- Any tool named in `tool_choice: { name: "..." }` (client is forcing it).
- Any tool already used in the conversation (appearing in prior `tool_use` / `tool_calls` turns) — dropping a tool whose results are already in context breaks the session.
- `ToolSearch` itself, if present — it is the deferred-schema resolution mechanism, not a domain tool.

After selection, replace `translatedBody.tools` with the subset and re-apply the `cache_control: ephemeral` annotation to the new last tool. This means the annotation logic should be **moved out of the two translator files** (`openai-to-claude.js:181` and `translator/formats/claude.js:430`) and into the disclosure layer so it always lands on the actual final tool, not an arbitrary pre-filter position.

### 4.4 Search backend

> **`turbovec` is not in this codebase.** It does not appear in any `package.json` or import. Do not assume it is available.

Recommended: **BM25 over concatenated name+description+parameterNames**. Zero new runtime dependencies. Accuracy ceiling is lower than vector search, but the bar here is conservative: include anything that *might* be relevant, exclude only clearly unrelated tools. That bar is achievable with BM25.

If BM25 false-negative rates are unacceptable after Phase 2 measurement, Phase 3 can upgrade the index to dense vectors. Options at that point: an embedded ONNX runtime with a small model, or turbovec if it is added as a dependency. Do not introduce embedding infrastructure until Phase 2 data justifies it.

---

## 5. Active Mode — Proxy-Loop Tool Discovery (Phase 3)

This is the direct implementation of the Agent SDK efficiency pattern inside 9router.

### 5.1 The pattern

Instead of pre-filtering tools (which still sends K schemas every turn), the active mode:
1. Sends the model **one synthetic tool** — `tool_search(query: string)` — plus any pinned tools (already used in history, forced by `tool_choice`).
2. The full schema set is held in the session index, not in `tools[]`.
3. When the model calls `tool_search`, 9router **intercepts** the tool_use in the response, runs BM25/vector search, and re-dispatches with the matching schemas injected.
4. The second response is what the client finally receives.

From the client's perspective: a single request, a single (slightly delayed) response. Internally: two upstream round-trips, with the first one resolved inside 9router. The model experiences the Agent SDK's discovery pattern without the client or MCP servers knowing.

### 5.2 Why this is "9router-native"

9router already does proxy-internal resolution loops:
- Format translation: a Claude-format request is re-shaped to OpenAI and back transparently.
- RTK `tool_result` compression: the request body is rewritten in-place before dispatch.
- Headroom: an external proxy compresses messages, the result is substituted, then the modified body is dispatched.

The active disclosure loop is the same pattern extended to the response path: detect a specific tool call in the model's response, resolve it internally, and fold the resolution back into the next dispatch.

### 5.3 Streaming vs non-streaming

**Non-streaming (simpler):** Buffer the full response JSON. If `stop_reason === "tool_use"` and the tool is `tool_search`, resolve and re-dispatch. The client's `await` simply waits a little longer.

**Streaming (harder):** Buffer the SSE stream until `stop_reason: "tool_use"` is confirmed in the `[DONE]`-adjacent events. This requires holding the SSE bytes without forwarding them to the client, then re-dispatching, then streaming the second response. This is the most significant implementation complexity in Phase 3.

An interim approach for streaming: downgrade to non-streaming internally for the first turn (tool discovery), then stream the final response. This adds one serialization round-trip but avoids the streaming buffer complexity.

### 5.4 Conversation history management

After the internal tool_search resolution, 9router must inject into the messages array:
- The assistant turn containing the `tool_search` call.
- A `tool_result` turn with the schemas as content.
- These are **never sent to the client** — they are internal to the proxy's re-dispatch.

On subsequent turns from the same session, the client's messages include its own conversation history (not the injected tool_search turns). 9router must merge its internal tool_search history with the client's history for correct context. This is the most complex state management aspect of Phase 3.

> **Uncertainty flag:** This is the highest-risk piece. Getting the conversation history merge right across turn boundaries — especially with different source formats, with passthrough paths, and with multi-account fallback retries — is non-trivial. Phase 3 needs a detailed sub-design before implementation.

---

## 6. Static Filter Config

```json
{
  "toolDisclosure": {
    "enabled": true,
    "mode": "passive",
    "maxTools": 20,
    "search": {
      "backend": "bm25",
      "minScore": 0.0
    },
    "filter": {
      "excludeServers": [],
      "excludeTools": [],
      "includeOnlyServers": [],
      "includeOnlyTools": [],
      "excludeDescriptionPattern": null,
      "includeOnlyDescriptionPattern": null,
      "alwaysInclude": []
    }
  }
}
```

| Field | Type | Meaning |
|---|---|---|
| `mode` | `"passive"` \| `"active"` | Passive = pre-filter; active = synthetic tool_search injection |
| `maxTools` | number | Top-K cap after BM25 scoring (passive mode). Ignored in active mode. |
| `excludeServers` | `string[]` | Exclude all tools matching `mcp__<server>__*` prefix. |
| `excludeTools` | `string[]` | Exact tool name exclusions. |
| `includeOnlyServers` | `string[]` | If non-empty, exclude any tool not from one of these servers. |
| `includeOnlyTools` | `string[]` | If non-empty, exclude any tool not in this list. Combined with `includeOnlyServers` via OR. |
| `excludeDescriptionPattern` | string (regex) | Exclude tools whose description matches. |
| `includeOnlyDescriptionPattern` | string (regex) | Exclude tools whose description does NOT match. |
| `alwaysInclude` | `string[]` | Tool names never filtered, regardless of BM25 score. |

`enabled: false` is a full bypass. The existing `TOKEN_SAVER_HEADER` (`X-9router-token-saver: off`) should also bypass the disclosure pass, consistent with how RTK and headroom respect it.

### Parity with Spring AI / LiteLLM

Spring AI's `McpToolFilter` takes `includedToolNames`, `excludedToolNames`, `includedServerNames`, `excludedServerNames`. The config above maps one-to-one. LiteLLM uses a callback-based `tool_filter`; the declarative pattern here is the better fit for 9router's JSON config surface and is immediately recognizable to anyone coming from Spring AI.

---

## 7. Compatibility with Claude Code's Deferred-Tool Mechanism

Claude Code's harness already has a deferred-tool system: tools appear as names only in `<system-reminder>` text; the model calls `ToolSearch` to resolve schemas, which the harness then injects into subsequent `tools[]`. This is entirely client-side and runs before 9router ever sees the request.

From 9router's perspective, `ToolSearch` is a function tool that arrives in `tools[]` like any other. The disclosure layer must **never filter `ToolSearch`** — it is the client's own schema-resolution mechanism, not a domain tool. Add it to the always-include list by default.

### Where 9router adds value the harness does not

| Capability | Claude Code harness | 9router disclosure |
|---|---|---|
| Defer schema loading | Yes (client-controlled) | — (operates on already-resolved schemas) |
| Static tool exclusion by policy | No | **Yes** |
| Cross-server deduplication | Limited (hardcoded built-ins) | **Yes** (config-driven) |
| Session-level index caching | N/A | **Yes** |
| Relevance-based selection | No | **Yes** (BM25 or vector) |
| Agent SDK discovery pattern | No | **Yes** (active mode, Phase 3) |
| Works for any client, not just Claude Code | N/A | **Yes** |

The two systems are complementary. The harness reduces which schemas ever get assembled into `tools[]`; 9router further reduces what the model actually sees — and can go further by eliminating the per-turn schema cost entirely in active mode.

---

## 8. Open Questions and Risks

### 8.1 False negatives in BM25 (passive mode)

Keyword mismatch can cause relevant tools to be filtered. "What's in my inbox?" → `mcp__gmail__list_threads` if "inbox" doesn't appear in its description. "Open a PR" → `mcp__github__create_pull_request` if the description says "pull request" not "PR."

Mitigations: `minScore: 0.0` by default (keep anything with any signal), `maxTools` set generously (20–30), always-include tools from prior turns. An offline evaluation set of (user message, expected tool names) pairs is required before enabling by default.

### 8.2 Streaming buffer complexity (active mode)

Intercepting a `tool_search` call mid-stream requires holding SSE bytes without forwarding to the client. This is the single most complex implementation risk. Interim mitigation: force non-streaming for the discovery turn, then stream the resolution turn.

### 8.3 Conversation history merge (active mode)

The proxy-internal `tool_search` assistant turn and tool_result must be injected consistently with whatever message format the client sends on the next turn. Cross-format, passthrough-path, and fallback-retry scenarios all need coverage. This needs a sub-design before Phase 3 implementation.

### 8.4 Index staleness

MCP servers can add or remove tools mid-session. The `toolSetId` hash detects changes on the next request and rebuilds. Staleness is bounded to one turn — same window as the harness's own staleness.

### 8.5 `cache_control` annotation migration

The `cache_control: ephemeral` stamp on the last tool is currently applied in two translator files. Once the disclosure layer controls the final tool list, those annotations should be removed from the translators and applied by the disclosure layer. This is a minor refactor with a small regression risk (cache invalidation if annotation lands on a different tool than before).

### 8.6 Passthrough path

When `isNativePassthrough` is true (`chatCore.js:167`), translation is skipped but tools still appear in `translatedBody.tools` (shallow copy of original body). The disclosure layer must apply to both passthrough and translated paths — confirm the insertion point is after the branch merges at line 196.

### 8.7 Token saver bypass

The existing `TOKEN_SAVER_HEADER` opt-out must bypass disclosure alongside RTK/headroom — keep behavior consistent.

---

## 9. Phased Plan

### Phase 0 — Measurement (no behavior change)
Emit a structured per-request log line with: tool count, `toolSchemaBytes`, `connectionId`, model, provider. Run for 1–2 weeks to establish real session distributions. The infrastructure half-exists in `headroom.js`'s `captureSizeSnapshot()`; the missing piece is a dedicated log line.

### Phase 1 — Static filter only
Implement `toolFilter()` per §6 config. Wire at `chatCore.js` after `dedupeTools`. Ship `excludeServers`, `excludeTools`, `enabled` fields first; pattern fields in a follow-up. Zero accuracy risk — declarative exclusion is as deterministic as the existing deduper rules. Requires no search infrastructure.

### Phase 2 — Passive BM25 disclosure
Implement BM25 index builder + per-turn query against the last user message. Add session-level cache keyed on `connectionId` + `toolSetId`. Wire after Phase 1 filter. Add `maxTools` and `alwaysInclude` config. Requires offline relevance evaluation suite before enabling by default. Ship behind `enabled: false`; opt-in per connection or globally. Move `cache_control` annotation from translators to this layer.

### Phase 3 — Active proxy-loop discovery
Design sub-document first (conversation history merge, streaming buffer strategy). Implement synthetic `tool_search` tool injection, response-path interception, internal re-dispatch. Start with non-streaming path only; extend to streaming in a follow-up. This is the full Agent SDK parity mode.

### Phase 4 — Vector backend (optional)
Upgrade Phase 2's BM25 to dense-vector search if false-negative rate is measurable and material. Evaluate turbovec or an embedded ONNX model at that point — not before Phase 2 data is available.

---

## 10. Summary of Findings

| Finding | Status |
|---|---|
| Tool schemas pass through unmodified today | Confirmed |
| No context-budget / token-cap logic for tools exists | Confirmed |
| `toolSchemaBytes` is already measured; never acted on | Confirmed (`headroom.js:37`) |
| `turbovec` is NOT a current dependency | Confirmed — not in any `package.json` |
| Existing deduper is hardcoded rule-based, not scale-aware | Confirmed (`toolDeduper.js`) |
| Natural insertion point: after `dedupeTools`, before RTK | Confirmed (`chatCore.js:205`) |
| `cache_control` annotation applied in two translator files | Confirmed — should migrate to disclosure layer |
| Claude Code's ToolSearch mechanism is harness-side, complementary | Confirmed |
| Passive mode maps to existing token-saver pattern | Confirmed |
| Active mode maps to existing proxy-resolution-loop pattern | Confirmed |
| "MCP is Dead" diagnosis is correct; 9router can implement the cure at the proxy layer | Confirmed |
