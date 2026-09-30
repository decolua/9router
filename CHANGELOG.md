# Changelog

## v0.5.151

- fix: show bulk import progress overlay and block closing the modal while a bulk add/import loop is running, split large codex/grok payloads into batches of 20
- fix: dedupe repeated auth-failure log lines per source/ip/key prefix so a misconfigured polling client no longer floods the log, 401 responses still sent
- fix: forward the backup password as x-9r-password header when polling the import job so password-protected imports track progress
- fix: resolve provider aliases for suggested-model fetcher lookup, fall back to built-in models with an error note when upstream is unreachable, tolerate upstream schema drift

## v0.5.150

- fix: show created-by label under each API key name on the endpoint page
- fix: include createdBy in POST /api/keys 201 response
- fix: open live-requests inspector stream without login gate, scope rows by key allowedModels, refresh every 5s
- fix: hide orphaned compat alias ghost groups in the model picker and clean up custom models plus aliases on provider node delete
- test: add structural backup self-check covering apiKeys permissions and createdBy round-trip

## v0.5.149

- fix: move tracing config into experimental and exclude user profile paths

## v0.5.148

- fix: mark db adapters external the next 14 way so bun sqlite skips webpack bundle

## v0.5.147

- fix: restore build dependencies dropped during next 14 downgrade

## v0.5.146

- fix: drop unknown webpack flag from build script for next 14.2.35

## v0.5.145

- fix: pin @types/react-dom to existing 18.x to fix Railway install

## v0.5.144

- fix: bump next to 14.2.35 to resolve high severity CVEs

## v0.5.143

- feat: show available models in apikey session usage
- feat: allow combo as custom model target with cycle guard

## v0.5.142

- feat: show centered loading overlay with progress while exporting, importing, or testing a backup
- feat: run backup import as a background job with per section progress so the UI stays responsive

## v0.5.141

- feat: include permissions and createdBy columns in apiKeys backup export/import
- fix: added createdBy "dashboard" value for dashboard users in POST /api/keys
- feat: add backup self-check for round-trip export->import preserving apiKey metadata
- fix: fix round-trip exportDb/importDb to preserve permissions and createdBy fields

## v0.5.140

- fix: stop the model picker heading a group with a generated node id
- fix: disambiguate compatible provider headings with a short uuid suffix so two custom providers never share one label
- test: add structural and distinctness cases for the new heading disambiguation in providerDisplaySelfCheck

## v0.5.139

- fix: correct a streamed tool-call name without holding the stream back
- fix: stop the model picker heading a group with a generated node id
- fix: rescue tool calls the client would reject with an invalid-args error

## v0.5.138

- fix: restore seren chat core