# 1. Model identity is (family, effort, mode); bands are derived, never inferred from ids

Date: 2026-08-11

## Status

Accepted

## Context

The tuner assigns every candidate a **band** — `fable`, `opus`, `sonnet`, `haiku`,
`below` — and a combo only admits candidates whose band is in its allowed set. The
band is therefore the gate: a model with no band is invisible to every combo, and a
model with the wrong band serves traffic it should never see.

Bands attach to entries in `tuner/bench.json`. Matching a candidate to an entry
ended in a substring scan:

```js
for (const key of Object.keys(bench.models))
  if (modelPart.includes(key)) return [key, bench.models[key]];
```

That guess failed in both directions at once, on the same model:

- `ag/gemini-3.1-pro-low` contains `gemini-3.1-pro`, so the **low-effort** variant
  inherited the full model's `opus` band and its benchmark scores — including a
  GPQA figure the low variant never produced.
- `ag/gemini-pro-agent`, which is the **high-effort** variant of the same model,
  contains no bench key at all. It had no band, so it was invisible to every combo.

The two together are how Odin — a `fable`-band combo with one band of permitted
fallback — came to serve `gemini-3.1-pro-low` for two full working sessions while
the high variant sat unused. The low variant then degraded badly under repeated
interrupts: it stopped tracking turn boundaries, emitted text in the user's voice,
forged a `[Request interrupted by user for tool use]` marker, and acted on the
instruction it had written for itself, producing commits nobody asked for.

`grok-4.5-low` and `grok-4.5-medium` had the same defect for the same reason, and
`gemini-2.5-flash-lite` was banded as though it were `gemini-2.5-flash`. This was
never one bad name.

The root cause is that a model id is one opaque string carrying three independent
facts — the **route** (`ag`), the **capability class** (`gemini-3.1-pro`) and the
**effort** (`low`) — and only the first is reliably positional. Providers spell the
rest however they like: antigravity says `gemini-pro-agent` where `devin-cli` and
`windsurf` both say `gemini-3.1-pro-high`.

There are 52 banded families against 959 registered models across 119 registries,
and `tuner/discover.mjs` finds more on its own, so the gap widens without anyone
acting. Any rule that guesses will keep guessing wrong at that scale.

## Decision

**A model's identity is declared, not parsed.** Registry model entries carry three
optional fields beside `upstreamModelId`:

- `family` — the capability class, matching a key in `bench.models`.
- `effort` — the declared compute level.
- `mode` — an orthogonal behaviour switch.

**Bands attach to families. Effort shifts the band by a declared offset**, from
`_effortBandOffset` in `bench.json`, a sibling of `_bands` / `_comboBand` /
`_comboDepth`. Offsets are signed in quality terms and clamp at both ends.

**Mode never moves a band.** `thinking` and `low` are different kinds of fact —
one says how a model answers, the other how much compute it is allowed — and
folding them into one field is how we would arrive back here.

**Matching is exact.** Substring inference is deleted. Resolution is: an explicit
`bench._modelIdentity` entry for the full id, then the identity the registry
declared, then an exact `bench.models` key equal to the model part or its last
segment. Nothing else matches.

**An unresolved candidate stays fail-closed, and is now loud.** It remains
invisible to every combo, and every tuner run names it, says whether the family is
undeclared or merely unbanded, records it in the tuner state, and posts the list to
the Discord webhook when it changes.

**Backfill is lazy.** A model whose id already equals its bench key declares
nothing. The 83 entries that only banded via substring are declared now; anything
else surfaces through the unbanded report and gets its two fields then.

## Consequences

The original bug becomes structurally impossible: `low` cannot reach its family's
band by any path, so a low-effort variant can no longer appear in a top-band combo.
`ag/gemini-pro-agent` becomes visible at `opus` for the first time — the high
variant now competes where the low one used to sit.

Five bands move and one model is newly banded. Fourteen ids lose a band they should
never have had: TTS and image models that were being ranked as chat models, and
three genuinely distinct models — `gpt-5.3-codex-spark`, its review variant, and
`openai/gpt-5.5-pro` — that were borrowing a neighbour's tier. Those three are left
undeclared on purpose. Giving them a family they do not belong to is the defect
this ADR removes; they need their own `bench.json` entries, which is a band
judgement, and this repository assigns bands by hand.

Every effort variant now needs its family declared or it goes dark. That is the
cost of exact matching, and the unbanded report is what makes it survivable.

The alternatives considered and rejected:

- **Rename the two bad ids.** Fixes the incident, not the rule. The next
  `-nano`/`-mini`/`-lite` suffix inherits its parent's band the same way.
- **One bench entry per (family, effort) pair.** Turns 52 curated entries into
  several hundred, and makes effort 55 individual judgements instead of one
  reviewable policy.
- **Effort adjusts score but not band.** A low variant would still sit in a
  top-band pool, which is exactly the failure being fixed.
- **Parse the id at read time.** The substring guess wearing a hat.
- **Promote model variant to a first-class record with its own table.** Real
  modelling, but a migration across 959 entries to solve what two declared fields
  already close.
