# 0002 — The router enforces frame integrity, not quality

**Status:** accepted · **Date:** 2026-08-11

## Context

A model served through this router can emit text that impersonates the client's
harness: the XML wrapper blocks a harness puts around its own bookkeeping
(`<system-reminder>`, `<instructions>`, `<command-name>`, …) or the literal
control lines it writes into a transcript (`[Request interrupted by user]`).

This is not the model writing a bad answer. It is the model writing in a voice
that is not its own. The router owns the framing of a conversation; the client
owns its content. A forged control marker is a **protocol** violation, and that
is what makes it actionable — it can be decided by inspection, without any
judgement about whether the response was good.

The router already reacted to part of this, inconsistently:

- The streaming path (`translator/response/openai-to-claude.js`) dropped whole
  harness tag blocks and recorded a discipline strike.
- The non-streaming and forced-SSE-to-JSON paths (`utils/echoScrub.js`) did the
  same for assembled bodies.
- The Codex/Responses branch did neither.
- **The tag vocabulary was declared twice**, in two files, with no link between
  them — the precise hardcoding this repo's conventions forbid. A marker added
  to one copy silently did not apply on the other path.
- Nothing reached the tuner. A model could forge the frame on every request and
  keep its band, its pool position, and its place at the head of a combo.

## Decision

**One vocabulary.** `open-sse/config/frameMarkers.js` is the single home for
`FRAME_TAGS` and `FRAME_CONTROL_MARKERS`, with `hasFrameMarker(text)` as the
predicate. Both former copies now import it.

**Detection is outbound only.** Only what a model produces is examined. The
inbound transcript is never rewritten: a user legitimately quoting
`[Request interrupted by user]` must survive intact.

**A violation is recorded as an error on the request** — `status: "error"` on
the `requestDetails` row that path already writes. That is the whole enforcement
mechanism. No new demotion machinery: `getHealth` in `tuner/tune.mjs` already
reads those rows, and its `recentErr > 0 && recentOk === 0 → h = 0` rule sinks a
persistently offending model within 30 minutes, reordering the pool on the next
tuner run. A model that forges the frame loses its position by the same rule
that governs a model that returns 500s.

**A violation is narrower than "the scrub changed something."** Repeating the
user's message back is poor output, not a forged frame, and does not reach the
health signal. It keeps the discipline strike and the nudge it arms.

### On stripping — the one thing this ADR reverses

The settled design said *detect, never strip*: stripping makes the router a
content editor, and that is not its job. The code already stripped, on two of
the four paths, and had done so in production for some time.

**Existing stripping stays; no new stripping is added.** Removing it would be a
user-visible regression justified by nothing but tidiness — harness tags leaking
into a rendered answer is a real defect those filters fix. But the boundary
holds where it still can: the control markers introduced here are **detected and
never stripped**, and the Codex/Responses path gains detection without gaining
an editor. Stripping is defence-in-depth on a legacy surface; the health signal
is the enforcement.

This is the honest position: the principle is right, the code predates it, and
the cost of retrofitting purity outweighs the benefit.

## Consequences

- Coverage: OpenAI chat completions, Claude messages, Gemini/Antigravity
  candidates, and the Codex/Responses branch all signal a violation.
- One walker (`forEachVisibleText`) serves both scrubbing and detection, so a
  new response shape is taught to both at once rather than to whichever the
  author remembered.
- **Streaming is signalled by strike, not by health.** The streaming filter sees
  the violation, but the accumulated content reaching `onStreamComplete` is
  already filtered, and the translator state has no channel to that write.
  Reusing `onDisciplineLock` was rejected: it marks the *account* unavailable,
  which is far too heavy for a model writing in the wrong voice. Wiring a
  per-request frame channel through `createSSETransformStreamWithLogger` (twelve
  positional parameters today) is the follow-up; until then a streaming
  violation records a strike and arms the corrective nudge.
- False positives are possible: a model quoting a harness tag inside a code
  fence while genuinely discussing this router is indistinguishable from forging
  one. Accepted — the health rule needs a sustained run of errors with no
  successes to act, so a single quoted marker costs nothing.

## Explicit non-goal

Nothing here judges whether a response is *good*. That door stays shut.
