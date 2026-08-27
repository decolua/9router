# Progressive Tool Disclosure — PR Description

## What this is

Design RFC (no code changes) for eliminating MCP's per-turn schema tax inside 9router — the problem where every tool schema for every connected MCP server travels in `tools[]` on every request, regardless of relevance.

Heavy sessions (8–12 MCP servers, 60–120 tools) spend an estimated **12–24k tokens per turn** on schemas alone — 10–15% of a 200k-token context window, recurring every single turn.

## Why now

Michael Rollins' ["MCP is Dead"](https://rollins.io/mcp-is-dead/) correctly diagnoses the structural issue: tool schemas travel the prompt on every turn, producing linear cost accumulation. The proposed fix there (replacing MCP with an Agent SDK `execute_code` discovery model) achieves the right thing — front-load schema cost to discovery turns, reference by name thereafter — but requires replacing the protocol. **9router can deliver the same efficiency at the proxy layer, transparently, without any changes to MCP clients or servers.**

> Credit: The core framing — "the MCP surface must travel in the prompt on every turn" — is Michael Rollins'. This work adapts his Agent SDK efficiency insight into a proxy-layer implementation that keeps MCP intact.

## Architecture in one sentence

Two new steps insert into `chatCore.js` after `dedupeTools()`, before RTK/headroom: a static filter pass, then a BM25-ranked selection pass — both parallel to existing token-saver patterns in the pipeline.

## Two modes

**Passive (Phases 1–2):** Pre-filter `tools[]` before each request. Static config-driven exclusion + per-turn BM25 relevance search against the user's last message. Session-level index cached by `connectionId` + tool-name hash. Reduces per-turn schema cost proportionally. Zero new deps (BM25 is ~80 lines of JS).

**Active (Phase 3):** Inject a synthetic `tool_search` tool; hold all schemas in the proxy index; intercept `tool_search` calls in the model's response; re-dispatch with matching schemas. Client sees one response; internally 9router runs two upstream turns. Achieves true Agent SDK efficiency — model pays schema cost only on discovery turns.

## What's in this doc

- Problem statement with token cost estimates (confirmed against codebase)
- Exact insertion point (`chatCore.js:205`, after `dedupeTools`)  
- Session-level index design + BM25 query approach
- Active mode architecture including streaming complexity and conversation history merge
- Config shape (parity with Spring AI's `McpToolFilter`)
- Compatibility analysis with Claude Code's native deferred-tool (`ToolSearch`) mechanism
- Phased plan: measure → static filter → BM25 passive → active loop → vector backend (optional)
- Open questions and risk flags

## Key findings from codebase audit

- Tool schemas pass through completely unmodified today (`chatCore.js:167–205`)
- `toolSchemaBytes` is already measured diagnostically (`headroom.js:37`) — never acted on
- `turbovec` is **not** a current dependency (not in any `package.json`)
- `cache_control: ephemeral` annotation is applied redundantly in two translator files — should migrate to the disclosure layer in Phase 2
- Claude Code's `ToolSearch` deferred-tool mechanism is client-side and complementary; 9router's layer operates on already-resolved schemas and adds capabilities the client can't provide (static policy, cross-session caching, any-client support)

## What's next

Phase 0: emit a dedicated `TOOLDISCLOSE` log line (tool count + `toolSchemaBytes` + session ID) on every request. Run for 1–2 weeks to confirm the token overhead is material before implementing anything.

## Not in this PR

No code changes. This is discovery + design only. Implementation starts with Phase 1 (static filter) in a separate branch once Phase 0 measurement confirms the problem at real-session scale.
