# OpenCode Go — Ox Alpha Free Image Input Design

Date: 2026-08-23
Branch: `local/opencode-go-all-endpoints-v2`

## Goal

Enable image input (vision) for `ocg/ox-alpha-free` (registry id `ox-alpha-free`,
provider alias/id `opencode-go`). This is a metadata-only change: declare the
model's capabilities so the existing modality pipeline stops stripping image
content. No runtime logic changes.

## Current Behavior

`PROVIDER_CAPABILITIES` has no `opencode-go` entry, so
`getCapabilitiesForModel("opencode-go", "ox-alpha-free")` resolves to
`DEFAULT_CAPABILITIES` (`vision: false`). `stripUnsupportedModalities`
(called from `open-sse/handlers/chatCore.js`) therefore removes `image_url`
content blocks and replaces them with
`"[image omitted: model has no vision support]"` placeholders before translation.

## Design

Add one provider-scoped entry to `PROVIDER_CAPABILITIES` in
`open-sse/providers/capabilities.js`:

```js
"opencode-go": {
  "ox-alpha-free": { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 1000000, maxOutput: 131072 },
},
```

- Selection mechanism: fallback-chain step 1
  (`PROVIDER_CAPABILITIES[provider][model]`, merged over
  `DEFAULT_CAPABILITIES`). `getCapabilitiesForModel` itself is NOT modified.
- Explicit fields: `vision: true`, `reasoning: true`,
  `thinkingFormat: "openai"` (OpenAI-compatible upstream, `reasoning_effort`
  style, consistent with sibling entries), `contextWindow: 1000000`,
  `maxOutput: 131072`.
- All remaining modalities inherit their `DEFAULT_CAPABILITIES` value and stay
  `false`: `videoInput`, `audioInput`, `pdf`, `imageOutput`, `audioOutput`.
  Unspecified feature fields (`search`, `tools`, `thinkingCanDisable`,
  `thinkingRange`) likewise fall through to defaults.

### Why data-only (no resolver/modality logic edits)

GitNexus impact analysis:

- `getCapabilitiesForModel` — CRITICAL risk, 61 dependents. Untouched.
- `stripUnsupportedModalities` — HIGH risk, 5 dependents. Untouched.

A `PROVIDER_CAPABILITIES` entry is pure lookup data consumed by the existing
resolution path; adding it edits no symbol in either hot function.

### Evidence and image-only scope

Official models.dev metadata for `ox-alpha-free` publishes input modalities
text/image/video. This iteration deliberately declares **vision only**: the
common video transport (video ingestion across client formats onto the OpenAI
chat wire) is not end-to-end yet, so declaring `videoInput: true` would
advertise behavior the pipeline cannot deliver. Video input is explicitly out
of scope for this change.

## Error and Compatibility Behavior

- Images travel as standard OpenAI-compatible `image_url` content blocks —
  base64 `data:` URLs or remote `http(s)` URLs — through the existing OpenAI
  chat path. 9router performs no re-encoding or conversion.
- Upstream errors/rejections surface through the existing executor error
  handling; no new error paths are introduced. The capability flag only gates
  local stripping; if the upstream rejects an image despite support, that is an
  upstream behavior, not a regression introduced here.
- Audio, PDF, and video inputs continue to be stripped by
  `stripUnsupportedModalities` with the existing placeholder text (behavior
  unchanged, since those capabilities stay `false`).
- Other providers/models are unaffected: the override matches only the exact
  pair `("opencode-go", "ox-alpha-free")`.

## Testing

Tests extend `tests/unit/opencode-go-models.test.js`:

1. **Provider-specific capabilities** — `getCapabilitiesForModel("opencode-go",
   "ox-alpha-free")` resolves `vision: true`, `reasoning: true`,
   `thinkingFormat: "openai"`, `contextWindow: 1000000`, `maxOutput: 131072`.
2. **Isolation** — the same model id under a different provider (e.g.
   `"opencode"`) or with no provider does not pick up these values
   (resolves to the pattern/default floor, `vision: false`); another
   `opencode-go` model (e.g. `glm-5.2`) does not inherit them.
3. **Modality pass-through** — an OpenAI-format request body whose message
   contains an `image_url` content block survives
   `stripUnsupportedModalities` with the block intact (not replaced by a
   placeholder).
4. **Video still false** — resolved capabilities keep `videoInput: false`
   (and `audioInput`/`pdf`/`imageOutput`/`audioOutput` remain `false`).

Verification target: targeted Vitest run of
`tests/unit/opencode-go-models.test.js` plus the directly relevant
capabilities/modality suites (e.g. `unit/capabilities.test.js` and modality
concern tests). Before any later commit touching source, run GitNexus
`detect_changes({scope: "compare", base_ref: "master"})`.

## Non-goals

- No changes to registry, executor, translator, or dashboard code.
- No live calls against the upstream endpoint.
- No version bump, `npm pack`, or install steps.
- Video input enablement (deferred until the common video transport works
  end-to-end).
- Changes to `getCapabilitiesForModel`, `stripUnsupportedModalities`, or any
  other shared logic.
