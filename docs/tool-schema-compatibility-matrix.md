# Tool-Schema Compatibility Matrix

Tracks provider-specific rejections of otherwise-valid OpenAI function-tool JSON Schemas, discovered in production. Each entry needs a reproduced failure (not a hypothesis) before it's added — see the scope guardrail in [#3667](https://github.com/decolua/9router/issues/3667): no global sanitizer or lowest-common-denominator schema weakening without evidence.

| Provider (routed via) | Rejected construct | Symptom | Handling | Evidence |
|---|---|---|---|---|
| OpenRouter → Cohere | Malformed `pattern` regex constraint (e.g. `"["`) on a `function.parameters` property | `HTTP 400: invalid function at tools[N].function: invalid 'parameters' provided: pattern must be a valid regex` | `open-sse/utils/toolSchemaCompatibility.js` strips only malformed `pattern` values before OpenRouter dispatch; valid patterns and all other schema structure pass through unchanged | Copilot Chat agent request, ~50 function tools, observed via a free-tier combo route. See #3667. |

## Adding an entry

1. Reproduce the failure with the minimal schema fragment that triggers it (redact tool/field names if they're user- or workspace-specific).
2. Confirm it's a genuine provider limitation, not a 9router translation bug — check whether the same request succeeds against the provider directly (bypassing combo routing).
3. Add a row above with the exact upstream error text and which 9router mechanism (if any) compensates.
4. If no mechanism exists yet, leave the "Handling" column as "none — tracked in #NNNN" rather than adding a fix speculatively.

## Open questions

- Whether OpenRouter/Cohere rejects a broader class of regex dialect features than just malformed patterns (unconfirmed — see #3667's follow-up list).
- Whether other OpenRouter-backed models in the free/cheap combo pool share Cohere's strictness, or whether this is Cohere-specific.
