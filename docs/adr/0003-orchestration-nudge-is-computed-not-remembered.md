# 3. The delegation count is computed by the router, not remembered by the model

Date: 2026-08-12

(0002 is retired — it belonged to the frame-integrity work undone in `81b6fcd4`.
Commit messages still reference it under that meaning, so the number is not reused.)

## Status

Accepted

## Context

The user's delegation rule lives in their client's `CLAUDE.md`: count the tool calls
that pull unseen content into the lead's context, and delegate the remainder at six.
It exists because a main-thread turn is priced by the context it carries — measured
across 119 local transcripts, a turn costs ~7,167 units under 25K of context and
~46,639 at 250K, so everything read inline is re-sent on every later turn.

The rule was delivered and ignored. Session `dce6e9bd` made **83 consecutive
`cat`/`grep`/`find` calls with zero delegations** — fourteen times the cap. It was
served by `gemini/gemini-3.1-pro-preview` (Fenrir #1) or `ag/gemini-pro-agent`
(Fenrir #2); the response id `gemini-pro-default` is what the upstream returned, which
is exactly what `x-9r-serving-model` and `utils/provenance.js` exist to record.

Three explanations were checked and eliminated:

- **Delivery.** A direct `claude:gemini` translator is registered
  (`request/claude-to-gemini.js:198`) and takes priority over the OpenAI pivot
  (`translator/index.js:83-85`). It maps `body.system` 1:1 into
  `systemInstruction.parts[]` (`:122-123`) with no concatenation, truncation or size
  cap. RTK and Headroom run *after* translation and are shape-gated to
  `messages`/`input`, so they structurally cannot touch a Gemini `contents` body.
- **Capability.** Tool definitions pass through unfiltered into
  `functionDeclarations[]` (`:168-184`). The Agent tool was present.
- **Banding.** The serving model was a legitimate in-band member of the combo it was
  asked for. A band floor would have changed nothing — a band is a benchmark score,
  not a measure of instruction-following, and any model in any combo can ignore a
  rule.

What remained is that a rule read once at the start of a session is buried under 174K
of context by turn 40 and stops being acted on. The rule was not missing. It was
forgotten.

## Decision

The router recomputes the count on every request and states the number back.

The client sends the whole conversation each turn, so every `tool_use` block is
already in the request body. `rtk/orchestrationNudge.js` walks back to the most recent
delegation, counts the calls that pulled unseen content since, and injects a line
naming the actual figure: a reminder at the cap, a firmer one at double it, plus a
callout when the previous delegation named no model — the condition on all 26
recursive spawns measured in this user's history, each of which silently inherited the
lead's expensive model.

Counting happens on the **source** body, where tool blocks are still in the client's
shape, and injection on the **translated** body through the existing format-aware
`rtk/systemInject.js`. That split is what makes one implementation reach every combo
and every provider format — Claude, Gemini, Vertex, Antigravity and every
OpenAI-shaped target — without per-handler wiring.

It is **stateless**, unlike `disciplineNudge`. That one corrects a past event and must
self-clear or it becomes a permanent tax. This reflects a condition that is still
true, so it should keep firing while the session is over cap and go quiet by itself
the moment a delegation resets the count. There is nothing to arm and nothing to
expire.

Unconditional, for the same reason the discipline nudge is: this is a policy
correction, not a token saver, and a lead fourteen calls over cap needs telling
whether or not compression is enabled. Fail-open like every rtk hook.

## Consequences

**This nudges; it cannot compel.** The router cannot make a model emit an Agent call.
The two stronger options were both rejected: failing the request breaks the session
over a policy preference, and synthesising a tool call the model did not make is
forging model output, which the router has no business doing — it owns the framing of
a conversation, not its content.

So the honest gain is twofold. Compliance improves for models that respond to
correction. For models that do not, the violation is now **measured** — a live,
specific count that was ignored is evidence that a model should not be a lead, on
data rather than on one bad session. That is the same shape as ADR 0001's reasoning
about bands: decide from recorded evidence, never from a guess about a model's name.

**What is not enforced here.** Fan-out disjointness and the sequential-chunk ceiling
are computable from the same body — file paths are in the tool inputs — but are not
implemented. They were left out because a false positive on either would push a lead
*away* from delegating, which is the opposite of the intent, and neither has the
measured backing the cap of six has.

**The cap is duplicated.** `NOVEL_CONTEXT_CAP` here must track the client's
`CLAUDE.md`. It is exported and asserted in `tests/unit/orchestration-nudge.test.js`
so a change on one side shows up as a test edit on the other, but the two files are
not linked by anything stronger than that.
