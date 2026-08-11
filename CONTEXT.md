# Context

The shared vocabulary of 9Router. This file is a glossary and nothing else — no
architecture, no configuration, no implementation detail. For how the system is
built read `docs/ARCHITECTURE.md`; for why a decision was made read `docs/adr/`.

Much of this language previously lived only in `tuner/bench.json` `_comment`
strings, where config and definition were the same paragraph. The definitions
belong here; the config stays there.

## Routing a request

**Route** — the provider prefix on a model id, together with the credentials and
quota domain it implies. The `ag/` in `ag/gemini-3.1-pro-low`. Two routes can
serve the same model and fail independently.

**Candidate** — a model this installation holds working credentials for. A model
being registered is not enough; a candidate is a model that could actually be
called right now.

**Pool** — the candidates admitted to one combo, after band and capability
filtering. Ordering within a pool decides who is tried first.

**Combo** — a named ordered list of models serving one client-facing name, with a
fallback strategy. When the model at one index fails, the next is tried.

**Quota domain** — the set of models that run out together. Two prefixes on one
subscription share a quota domain even though they are different routes: if one
returns 429, the other is already exhausted.

## Judging a model

**Family** — a capability class, such as `gemini-3.1-pro`. The family is the unit
that carries a band and the unit of curation: one entry per family, not one per
id. Distinct from **quota family**, which groups quota and shares only the word.

**Effort** — a declared compute level: `minimal`, `extra-low`, `low`, `medium`,
`high`, `max`. Effort shifts its family's band by a declared offset. It never
inherits the family's band unchanged, because a low-effort variant has not earned
what the full model earned.

**Mode** — an orthogonal behaviour switch: `thinking`, `agentic`, `review`,
`preview`, `fast`. A mode changes how a model answers, not how good it is, so a
mode never moves a band. `thinking` is a mode, not an effort level.

**Band** — a quality tier: `fable`, `opus`, `sonnet`, `haiku`, `below`, best
first. Bands are hand-assigned to families from published benchmarks and
judgement; they are never computed, and never inferred from the shape of an id.

**Unbanded** — a candidate whose band could not be derived, because no family is
declared for it or because its family has no entry to band. An unbanded candidate
is invisible to every combo, and is reported by name on every tuner run.

**Cost class** — whether calling a model spends something finite. Free capacity is
preferred over a subscription regardless of band, because a subscription burned
at the head of a combo is spent on every request until it fails.

**Health** — the recent success ratio of a route, derived from request outcomes
already recorded. A route with recent errors and no recent successes is treated
as dead until it succeeds again.

## Owning the conversation

**Frame integrity** — the router owns the framing of a conversation; the client
owns its content. Control markers that belong to the client's harness are part of
the frame. A model emitting one is committing a protocol violation, not writing
bad content — and that distinction is the whole boundary. The router does not
judge whether a response is good.

## Naming

**Model id** — a wire name, not a description. `ag/gemini-3.1-pro-low` carries a
route, a family and an effort in one opaque string, and providers spell the same
fact differently: `gemini-pro-agent`, `gemini-3.1-pro-high`. What an id implies is
never read back out of it — family, effort and mode are declared. See
`docs/adr/0001-model-identity-and-band-derivation.md`.

**Upstream model id** — the id actually sent to the provider, when it differs from
the id clients use. The registry id is not the upstream identity.
