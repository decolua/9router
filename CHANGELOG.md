# v0.5.107-Custom (2026-09-19)

## Custom Features & Enhancements
- **Auto Update restored**: the sidebar "Update now" button calls the real updater endpoint again. The detached updater installs the new version, restarts 9Router and reopens the dashboard on its own, with live progress (phase and installer log tail) shown in the overlay while the server is down. If the updater is unavailable, for example in a dev build, the flow falls back to the existing copy-command panel so there is always a working path. Failed installs surface the installer log with a reload button instead of a silent hang.

# v0.5.106-Custom (2026-09-19)

## Custom Features & Enhancements
- **New plugin: Speed Mode**: a fourth Custom Plugin that makes selected models answer instantly instead of reasoning. It injects a direct-answer system instruction and forces a thinking "none" intent, which the unified thinking pipeline converts into each provider's native disable format (OpenAI `reasoning_effort`, Claude `thinking: disabled`, Gemini budget 0, Qwen `enable_thinking: false`, and so on). Claude-native requests set the disable flag in the Anthropic shape so native passthrough never sends an unknown field. Selected models get a cyan bolt badge in the model lists and the plugin picker, managed exactly like the existing plugins on the Custom Plugins page.

# v0.5.105-Custom (2026-09-19)

## Fixes
- **GitHub link label visible on mobile**: the header "Visit On GitHub" text was hidden behind a responsive `hidden sm:inline` class and showed only the logo on small screens; the label now always renders next to the icon.

# v0.5.104-Custom (2026-09-19)

## Custom Features & Enhancements
- **Simplify backup section picker**: removed the "Select All" and "Lightweight Only" quick actions from the Download Backup dialog; sections are now picked with the individual checkboxes only.

# v0.5.103-Custom (2026-09-19)

## Fixes
- **OpenCode free tier: stop 403 FreeTierError on tool-carrying agent requests**: the free tier fingerprints the official agentic client inside the request body. The `/zen/v1/responses` gate now requires the `bash` + `read` tool decoys plus `tool_choice: "auto"` on every request (previously they were only injected when the payload had no tools at all, so any real agent call carrying 1..N tools went out naked and received 403), and the `/zen/v1/chat/completions` gate requires the full `bash`, `glob`, `grep`, `read` quartet, which is now appended whenever any of the four is missing. External client tools are preserved verbatim and only missing fingerprint names are added as no-op declarations. `muse-spark-1.2-contributor-free` is added to the force-auto tool choice quirk alongside 1.3 since both free models reject non-auto choices with 400.

# v0.5.102-Custom (2026-09-19)

## Custom Features & Enhancements
- **DeepSeek Web tool calling support**: the cookie-based DeepSeek Web provider now supports OpenAI tool calling. Because the web backend is a text-only RAG endpoint, the executor encodes the requested tools as a protocol inside the prompt, converts previous assistant tool_calls and tool result messages into readable transcript turns, and parses the model's reply back into standard OpenAI `tool_calls` deltas with `finish_reason: "tool_calls"` for both streaming and non-streaming requests. Requests without tools follow the original flow unchanged.

## Fixes
- **Usage visible after backup import**: the Usage Overview Today and 24h views now merge the daily aggregates that shipped inside the backup (for days before today) with live request history, so restored usage is no longer hidden behind an empty default period. Verified with a real export-import roundtrip: restored rows show up in today, 24h and 7d views, while live-only data is never double counted.

# v0.5.101-Custom (2026-09-19)

## Custom Features & Enhancements
- **Remove 9Remote & 9English menus**: dropped the 9Remote promo entry, the 9English external link, and their unused modal components from the sidebar to keep navigation focused on router tools.

# v0.5.100-Custom (2026-09-19)

## Fixes
- **Modal header polish**: the "Welcome to 9Router!" title no longer hugs the left edge of the dialog and now sits vertically centered on the same line as the close button. Applied to all dialogs, including the Download Backup header.
- **Smaller "Heavy" badge**: the Heavy tag in the Download Backup section list now renders in the compact badge size instead of falling back to the large default.

# v0.5.99-Custom (2026-09-18)

## Custom Features & Enhancements
- **DeepSeek Web (Cookie) Provider**: added `deepseek-web` under the Web Cookie Providers category (positioned between Free Tier and API Key providers). Supports web session token auth (`userToken` from `chat.deepseek.com`), streaming responses, and reasoning content (`<think>`) for models: `deepseek-chat`, `deepseek-reasoner`, `deepseek-v4.1-flash`, `deepseek-v4.1-pro`, `deepseek-v4.1-reasoner`, `deepseek-v3`, and `deepseek-r1`.
- **Remove Automatic Backup**: decommissioned the scheduled automatic background backup feature and modal to keep the app lightweight, retaining the standard manual Download Backup and Import Backup tools.
- **Selective Backup Download**: the Download Backup dialog now lets you pick which sections to include (Settings, Providers, API Keys, Combos, Custom Models, Pricing, Usage History). Each section shows its item count and estimated byte size, and the total selected size updates in realtime. Heavy sections (e.g. Usage History) are unchecked by default. Old full backups remain fully import-compatible.

# v0.5.98-Custom (2026-09-17)

## Fixes
- **Keep original base models visible alongside custom models**: creating a custom studio model no longer hides or overwrites the underlying base model. Both the original target model and the newly created custom model stay fully visible in model pickers, provider details, and `/v1/models`.

# v0.5.97-Custom (2026-09-17)

## Fixes
- **Fix OpenCode Free Tier 403 FreeTierError**: resolved `"OpenCode's free tier can only be used from within OpenCode"` by tailoring request headers with `User-Agent: opencode/1.18.30`, `anthropic-version: 2023-06-01`, and conforming 30-character OpenCode session and request identifiers (`ses_*`, `msg_*`).
- **Add Union Alpha & Union Alpha Free support**: added `union-alpha` and `union-alpha-free` to OpenCode's registry with targetFormat `claude` (routed directly to `/zen/v1/messages`), configured vision and reasoning capabilities, and added it to suggested models.

# v0.5.96-Custom (2026-09-17)

## Custom Features & Enhancements
- **Uncensored Output Plugin Updates**: renamed the third plugin to *Uncensored Output* and updated its icon to an emerald/red key off (`key_off`) badge. Added fallback model matching across requested, routed, and full model identifiers so plugin directives reliably inject into System prompts.
- **Header "Visit On GitHub" Button**: enhanced the GitHub repository link button in the top right header to display a clear "Visit On GitHub" text label next to the GitHub logo.
- **Sidebar & UI Polish**: renamed "Custom Models & Editor" to "Custom Models", updated the "Custom Plugins" icon to `widgets`, renamed "Settings" to "9Router Settings", and cleaned up top traffic-light decorative dots.
- **Custom Provider & Studio Target Picker Fix**: custom providers now stay visible in model selectors even when their underlying base models are mapped to studio custom model names. Upgraded logo data URL storage capacity and added JPEG compression fallback so custom provider logos never vanish.

# v0.5.95-Custom (2026-09-17)

## Custom Features & Enhancements
- **Direct Override (Unrestricted) Plugin**: added a third custom plugin featuring an open padlock icon (`lock_open`). When attached to selected models, it injects an anti-refusal system directive and technical framing, minimizing standard canned AI refusals for pentesting, code security, and raw technical queries. Enables the `lock_open` badge for selected models.

# v0.5.94-Custom (2026-09-17)

## Custom Features & Enhancements
- **Custom Plugins menu under FEATURE+**: added `/dashboard/plugins` featuring two modular plugins:
  - **Image Vision**: extracts text and visual content from images for models that don't natively support vision, making non-vision LLMs able to read image inputs from CLI tools and agents. Enables the Vision (👁️) badge for selected models.
  - **Think Deeper**: forces deep step-by-step chain-of-thought reasoning before outputting final answers. Enables the Reasoning (🧠) and Think Deeper (💡/psychology) capability badges for selected models.
- **Model selector integration**: users explicitly choose which models to attach plugins to via `ModelSelectModal`.

# v0.5.93-Custom (2026-09-16)

## Custom Features & Enhancements
- **Top-positioned logo in provider creation/edit dialogs**: the custom provider Logo upload field is moved to the very top before the Name field across custom compatible and embedding forms.
- **Edit custom provider logo**: the edit modal for compatible nodes now includes the logo picker and saves logo updates directly.
- **Provider logo display on Usage**: custom compatible nodes without custom logos now cleanly fallback to their parent provider image (e.g. OpenAI / Anthropic icons) instead of displaying abbreviation text badges like "OP".

# v0.5.92-Custom (2026-09-16)

## Fixes
- **Fix LAN/Docker default login password**: trusted-peer auth now falls back correctly for local and container deployments.
- **Fix usage errors page always showing 0**: error tracking counts are now persisted and read back properly.

## Custom Features & Enhancements
- **Add backend GitHub update detection with commits behind**: the version API now compares the local checkout against the upstream branch and reports how many commits behind, the latest commit message, and a tailored install command.
- **Add Welcome Modal with star request and update info**: a post-login modal invites users to star the GitHub repo and, when an update is available, shows the commit count, message, and a copyable install command. Dismissible per-session or permanently.
- **Hide Skills menu from Sidebar**: the Skills navigation item is removed from the System section.

# v0.5.91-Custom (2026-09-16)

## Custom Features & Enhancements
- **A custom (studio) model now hides the model behind it**: the moment a base model gets a studio name, that base model disappears from every place a client or a picker reads — `GET /v1/models` and its per-kind variants answer with the studio name only, the model pickers (API key allowed models, combos, CLI tool mappings, arena) offer the studio name only, and the provider page Models tab lists the studio name only. So with `qwen-3.8` pointed at `neko/qwen3.8-flash`, nothing shows `neko/qwen3.8-flash` anymore. The raw model is still routable and the Model Studio editor still sees it, because that is exactly where you pick the model a new name should call. The rule is shared in one helper (`buildStudioTargetIndex`) keyed by provider id plus model id, case-insensitive, so the same model name under another provider stays visible.

## Fixes
- **The x on an allowed-model chip now removes that model**: in the API key forms the chips called a handler that branched on which picker modal was last opened, so with a freshly opened form (or before ever pressing Select Models) clicking x did nothing. Removing and adding models now state plainly which field they edit, and the chip lists in both the create-key and edit-key forms work on their own.

# v0.5.90-Custom (2026-09-16)

## Custom Features & Enhancements
- **Custom providers can carry their own logo**: the Add and Edit dialogs of every custom node type (OpenAI compatible, Anthropic compatible, MoonshotAI compatible, custom embedding) gained an optional **Logo** field. Pick any PNG, JPEG, WebP or GIF up to 2 MB and the browser crops it to a square, scales it down and stores a few kilobytes on the node; leave it empty (or press Remove) and the familiar default brand icon stays exactly where it was. The chosen logo shows on the provider card, the provider detail header, the media provider list and header, and on Usage in the provider map beside the traffic animation. Because it lives inside the node record, it also travels with Download/Import Backup and the automatic Telegram or GitHub backup.
- **Logo values are checked on the way in**: the API accepts a logo only as a compact image data URL (no SVG, no remote URL, no oversized payload) and answers with a plain message otherwise, while the picker refuses unreadable files before anything is saved. An update that omits the field leaves the stored logo alone; sending an empty one clears it.

# v0.5.89-Custom (2026-09-16)

## Fixes
- **Automatic backups now really go out**: the scheduler tick used to hold the same in-flight lock that the send function checks, so every scheduled run rejected itself with "A backup is already being sent" and only retried 30 minutes later, forever. The tick now just decides when a run is due and hands the send over; a regression case drives a due tick against a stubbed Telegram API and asserts one upload actually leaves the process (it fails on the old code, passes on the new one).

## Custom Features & Enhancements
- **A live countdown tells you when the next backup lands**: under the Automatic Backup button, and again inside the dialog with the exact date, a timer now ticks every second ("Next backup in 23:59:05") against the real schedule instead of a guess. The API answers with the next run taken from the running scheduler, falling back to the stored last-send stamp plus interval, and the page re-reads it the moment the countdown reaches zero. Typed bot or GitHub tokens survive that refresh.

## Improvements
- **Automatic-backup code nesting fixed**: the service, the config repo and the settings route now use the same two-space-per-level indentation as the rest of `src`, and the startup wiring sits flush with the schedulers next to it. The confirm-password dialog no longer claims the file goes to Telegram when the GitHub channel is selected.

# v0.5.88-Custom (2026-09-14)

## Improvements
- **The Telegram owner id is now strictly numeric**: the Automatic Backup dialog only accepts digits (non-digits are filtered out while typing, the server rejects anything else with a clear message), since bot sends require the numeric owner id and the "@username" style hint was misleading.
- **UI copy cleaned of decorative dashes**: status, hint and placeholder strings across the Automatic Backup dialog now use plain punctuation, and the few misaligned indent lines the previous feature commits introduced in the profile page were normalized to the file's existing style.

# v0.5.87-Custom (2026-09-14)

## Custom Features & Enhancements
- **Automatic Backup moved into its own dialog and learned GitHub**: instead of a full card on the settings page, a single **Automatic Backup** button now sits right above Download Backup — it opens a modal where you pick the channel (Telegram bot or GitHub repository with a write-scoped token, committing to `9router-backups/` plus a `latest.json` pointer on a chosen branch), set the interval, then press **Save Configuration** to store everything and arm the schedule in one click; **Send Test Backup** delivers one backup immediately (password-confirmed) so the whole path can be verified on the spot. Both bot and GitHub tokens are now encrypted at rest with a machine-bound key, so no plaintext credential is ever written to the database or echoed back to the browser.

# v0.5.86-Custom (2026-09-14)

## Custom Features & Enhancements
- **Backups now deliver themselves to Telegram**: a new Auto Backup (Telegram) card sits above Download Backup in the profile page — set a bot token and owner chat id, pick the interval (every 24 hours, 7 days, 30 days, or custom hours), and the scheduler exports the exact same database backup the manual button downloads and sends it to your chat as a `9router-backup-*.json` file, importable with Import Backup unchanged. The token is stored write-only (never echoed back to the browser, kept out of the settings blob), the schedule survives restarts through the persisted last-sent stamp, sends follow the outbound proxy, oversized backups beyond the bot's upload cap are refused with a clear status instead of a silent stall, and a Send Test Backup button (password-confirmed like the other backup actions) verifies the whole path on demand. The configuration also travels inside every backup, so a restored instance resumes sending on its own schedule.

# v0.5.85-Custom (2026-09-13)

## Custom Features & Enhancements
- **A key's allowed models now also decide what it can see**: `GET /v1/models` (and `/v1/models/{kind}`, `/v1/models/{provider}/{model}`) answers through the same patterns the request gate uses, so a key limited to `claude-fable-5.1` lists exactly that one model instead of advertising names it would refuse with `403`.

## Fixes
- **Two custom models on the same base model stop trading places**: older builds stored a display alias for every Model Studio name, and with two names aimed at one target the alias lookup answered whichever matched first — so calling `gpt-5.6-sol` could show up as `claude-haiku-5`, or as the bare base model. Studio names are now cleaned of any leftover alias, whatever value it held, and an alias that carries a studio name can no longer add a second entry for the same model to the listing.
- **A model name that is not a string is refused instead of crashing**: an array or object in `model` reached SQL as a bound value and died with `Unknown named parameter '0'` inside a 500; it now returns a plain `400 Missing model`.

# v0.5.84-Custom (2026-09-13)

## Fixes
- **A custom model typed with its provider prefix now resolves**: a Model Studio target saved as `kr/gpt-oss-120b` was read with a bare parse, which handed the prefix back as the provider, matched no credentials, and left the usage row named after the base model — the target is now resolved the same way any other call is, so the studio name is what answers and what Usage bills, while `resolvedModel` still records the base model beside it.
- **A per-model override may name another provider**: an override whose target carries a prefix is resolved first instead of pasting `prefix/model` onto the current provider, which produced a doubled path upstream.

# v0.5.83-Custom (2026-09-13)

## Improvements
- **The two Workshop tools are named after what they do**: **Compare Models** runs one prompt across models side by side, and **Custom Models & Editor** is where those extra model names live.
- **The changelog is one card per day**: releases that landed on the same date now share a single bordered block, with each version kept as its own sub-heading inside it.

## Fixes
- **The live request panel follows the name you called**: in-flight and streaming requests were tracked under the model the gateway resolved to, so Usage could list `claude-sonnet-5` and `qwen-3.8` at the same moment for one key.
- **Embeddings stopped splitting a custom model into two rows**: its usage record and its failure text named the resolved target, while every other endpoint reported the studio name, which is what made both names pile up in the same leaderboard.

# v0.5.82-Custom (2026-09-13)

## Custom Features & Enhancements
- **A Model Studio name now answers as the model it is**: every outbound payload — non-streaming completions, streamed chunks, Claude `message_start`, Responses events and semantic-cache hits — reports the name the caller spoke, so `claude-opus-5` never answers `qwen3.8-flash` while the console, the request detail and the usage `resolvedModel` still record the real target for debugging.
- **Failure text keeps the route private too**: the "all accounts unavailable" and "no credentials" replies name the model that was called instead of printing the provider connection id and the model behind it.

# v0.5.82-Custom (2026-09-13)

## Custom Features & Enhancements
- **Every API key has an on/off switch**: the toggle sits on the left of each key row, is stored through the existing key update endpoint, and a switched-off key is refused with `403 API key is disabled` on chat, embeddings, images, video, speech, transcription, search and web fetch — including while the gateway runs without required keys.
- **FEATURE+ is the section title again** for the tools this fork adds, with Model Battle Arena and Custom Model Editor inside it.

## Fixes
- **Per-key limits now apply to every endpoint**: chat compared the validator's reason strings one by one while the other endpoints only checked them for truthiness, so an over-quota, expired or model-restricted key could still generate images, embeddings, speech and searches.
- **A switched-off key can no longer be traded for remote access**: the edge guard accepted any non-false validation result, so the document writer's and battle arena's reason strings unlocked `/v1/*`.

## Removals
- **PRD Document Writer is gone**: its page, prompt library, checklist reader and saved drafts are deleted, and a migration prunes the drafts an install already has so the database stays clean.
- **Provider Health is gone**: the board page and its snapshot reader are deleted, while `GET /api/health` stays exactly the anonymous `{"ok":true}` liveness probe that tunnels and uptime checkers ping.

# v0.5.80-Custom (2026-09-13)

## Improvements
- **Workshop menu names now say what the tool does**: the three custom tools are **Model Battle Arena**, **Custom Model Editor** and **PRD Document Writer** in the sidebar, in each page header and in the model picker group, so nothing has to be guessed from a one-word nickname.
- **Icons finally respect their own size**: the Material Symbols defaults were an unlayered vendor stylesheet, so every icon rendered at a fixed 24px no matter what was written on it — they now live in Tailwind's base layer and the icon font is declared in `globals.css`, so a `text-[14px]` icon is 14px.
- **Icon and label share one centre line**: each sidebar and page-title icon is a fixed square flex box that a long label can no longer squash, which is what made rows look crooked.
- **Model picker group renamed**: the studio group in the model picker is **Custom Models** and its chips carry a `custom` tag instead of the old tool name.

# v0.5.79-Custom (2026-09-12)

## Fixes
- **A provider that answers JSON when we asked for a stream no longer hangs**: the gateway now reads the response content-type and either replays the completion as live SSE for a streaming client or serves the normal JSON path, so the answer arrives and tokens are billed.
- **Unreadable upstream bodies fail loudly**: a body that is neither a stream nor valid JSON now returns a clean gateway error instead of a 200 response with nothing in it.
- **Event-stream bodies are parsed whatever they contain**: a plain JSON document wearing an SSE label, NDJSON rows, Claude Messages events and Responses-API events all decode into a real answer instead of `Invalid SSE response for non-streaming request`.
- **NDJSON providers work while streaming too**: lines that arrive without a `data:` prefix are now read as frames instead of being dropped, so those upstreams no longer look like an empty model.
- **A transport quirk no longer grounds an account**: response-shape errors are classified as `lock: false`, so a provider that answers in the wrong format can no longer put a working credential behind a "(reset after 30s)" cooldown.
- **Studio names stay separate in Usage**: two Forge names pointing at one model now each keep their own row and stats bucket, because the calls that used to produce no usage record at all are producing one.

# v0.5.78-Custom (2026-09-12)

## Fixes
- **Showdown streams live**: every contender now paints its answer token by token with a ticking elapsed timer, so a slow model reads as "still working" instead of a frozen spinner with no feedback.
- **One streaming client for both tools**: Showdown and the PRD Writer now talk to the gateway through the same `streamChatCompletion` helper, so reasoning deltas, usage capture and readable error parsing behave identically on both pages.

## Custom Features & Enhancements
- **Time-to-first-token is measured**: each battle card reports first token, total time, tokens and cost, and the result table gains a First token column with its own badge.
- **Battles can be stopped**: the run button turns into Stop while anything is in flight, and a cancelled card keeps its partial answer labelled as stopped instead of showing a red failure.

# v0.5.77-Custom (2026-09-12)

## Fixes
- **A rejected request no longer grounds an account**: 400, 406 and 422 from a provider are now classified as caller mistakes, so they surface immediately instead of cooling the credential for 30 seconds and dragging every other account through the same failure.

## Custom Features & Enhancements
- **PRD Writer document profiles**: four new profiles — RFC / Tech Spec, Release Notes, Competitive Analysis and Bug Report → Fix Plan — each with its own section outline built from 25 freshly written section briefs.
- **PRD task list**: one button turns a finished PRD into an ordered `- [ ]` checklist, either parsed straight from the plan section (dependency order, owners, estimates, follow-ups) or extracted by the model when the plan is prose, with copy and `.md` download.
- **Provider Health board**: a new page that rolls the request log into per-account and per-model success rate, p50/p95 latency, spend, last error and a live cooldown countdown, with test-now and pause/resume wired to the existing endpoints.
- **Provider Health stays private**: the bare `GET /api/health` probe still answers `{"ok":true}` for tunnels and uptime checks, while `?window=` board data requires a dashboard session and never leaves request or response bodies on the server.
- **Provider Health explains itself**: the board says when request logging is switched off in Settings instead of showing a page full of zeros.

# v0.5.76-Custom (2026-09-12)

## Fixes
- **Showdown shows real outcomes**: a model that answers with HTTP 200 but no text is now labelled `empty` with the reason why, instead of dumping raw JSON into the result card.
- **Showdown errors are readable**: provider failures show one short line plus HTTP status, cooldown and route chips, with the untouched payload behind "Show the raw error".
- **Silent models can no longer win**: awards and the top ranking ignore answers that produced nothing, so an empty response can't be declared the fastest.
- **PRD Writer errors formatted**: generation failures surface the parsed provider message with a collapsible raw detail, and a completion that returns nothing is reported as empty instead of leaving a blank document.

# v0.5.75-Custom (2026-09-12)

## Custom Features & Enhancements
- **PRD Writer**: a workshop tool that turns a short brief into a full, reviewable product requirements document, and it will not generate until you have picked the model that writes it.
- **PRD controls**: choose the document profile, depth, language, output-token cap and the exact sections to write, then watch the document stream in live.
- **PRD review pass**: an optional second model red-teams the draft, lists up to 12 defects, and rewrites the whole document with the missing sections filled in.
- **PRD proof and storage**: a section checklist reports which required headings actually arrived, and every document can be saved, reopened, copied, downloaded as `.md`, or inspected through the exact prompt that produced it.
- **Workshop menu names**: the custom-tools group is now the single word **Workshop**, and its tools no longer share the word "Model" — **Showdown** (was Model Battle) and **Forge** (was Model Studio).
- **Distinct menu icons**: Console Log now uses a monitor icon and its log card a list icon, so it no longer looks identical to CLI Tools.

# v0.5.74-Custom (2026-09-11)

## Fixes
- **Model Studio no longer renames the original model**: a studio name is now resolved through its own record instead of writing a display alias, so `claude-fable-5` appears as an added entry while `custom1/claude-sonnet-5` keeps its own name in every picker.
- **Legacy studio aliases cleaned up**: display aliases left behind by older builds for studio names are deleted the first time the studio list loads, so previously renamed models reappear under their real name.
- **Usage shows the called studio name everywhere**: the name you call (e.g. `claude-fable-5`) is now recorded as the request's model across Overview, Leaderboard, Logs and Details, with the real backend model kept only as muted `→ provider/model` text and cost still priced from it.

## Custom Features & Enhancements
- **MoonshotAI logo is reliable**: compatible nodes created from the MoonshotAI button are tagged with a brand, and that tag (not just the name) now picks the `moonshot-ai.png` logo on cards, the detail page, and its colors.

# v0.5.73-Custom (2026-09-11)

## Fixes
- **Model Studio page crash**: the per-card copy button now uses the shared copy hook, so a saved model no longer throws the client-side `ReferenceError` that showed "This page couldn't load".
- **Model Battle data load**: the missing API-key and Model Studio fetch is restored, so a key is pre-selected and virtual (studio) names are priced by their real target model.
- **Sub-cent battle costs**: costs now show enough digits (e.g. `$0.0034`) instead of every row reading `$0.00`, so the cheapest badge means something.
- **Backup round trip**: exports now carry `disabledModels`, and import clears the stale request log in the same transaction while keeping usage history in its original order.
- **Duplicate API key names on rename**: renaming an existing key to a name already in use is now rejected (HTTP 409) with the reason shown in the UI, matching how key creation behaves.

## Custom Features & Enhancements
- **No password nagging**: the tunnel/endpoint page no longer warns about the default dashboard password or blocks activation over it — the tunnel turns on as-is.
- **Models are picked, never typed**: the allowed-models field in the API key dialogs is read-only; models come from the picker only (chips + Select Models), so a typo can no longer lock a key out of a model.
- **Changelog works offline**: a local `/api/changelog` route serves this fork's changelog from disk, falling back to raw GitHub only for what it cannot resolve; the custom section is labelled **Contributed by Serenhope**.
- **CLI default password**: the terminal settings menu now reports `seren123` as the default dashboard password instead of the old upstream value.
- **UI polish**: long sidebar labels, provider/model ids, tool titles, badges and the header search now ellipsize instead of pushing buttons out of place, with the full text available on hover.
- **Sidebar group renamed**: `Model Lab` is now **Custom Suite** — it holds every feature added by this fork, not only the model tools, so future additions have an obvious home.

# v0.5.72-Custom (2026-09-10)

## Custom Features & Enhancements
- **Model Studio (was Model Editor)**: pick any connected model (built-in, custom provider or compatible) and give it your own callable name, display name, context window and injected system prompt, which then resolves in chat, `/v1/models`, and every model picker.
- **Model Battle (was Model Arena)**: Side-by-side comparison now supports up to 4 contenders, estimated cost per run, and a **Final Result** board — fastest / cheapest / longest badges, plus a manual "My pick" so quality is decided by you, not a judge model.
- **Menu Renames**: The `Feature+` group is now **Model Lab** containing **Model Battle** and **Model Studio**.
- **MoonshotAI Logo**: MoonshotAI compatible providers now use the uploaded `moonshot-ai.png` brand image on cards and detail pages.
- **Provider Prefixes**: Kept in Model Studio — one editable prefix per custom provider (`prefix/model-id`).

# v0.5.71-Custom (2026-09-10)

## Custom Features & Enhancements
- **Model Editor**: Edit per-model overrides (rename, target model, context window, system prompt) and manage custom provider prefixes from a dedicated Model Editor page under Feature+.
- **MoonshotAI Provider**: Added MoonshotAI (Kimi) compatible provider option alongside OpenAI/Anthropic compatible providers.
- **Extra Combo Strategies**: New combo routing strategies beyond Fallback / Round Robin / Fusion.
- **Changelog View**: Combined changelog modal — custom contributions shown in a highlighted "Contributed by Seren" section above the official Decolua release notes.
- **UI Cleanup**: Refined dashboard layout, tidied console log view, and removed the Live Feed page and related controls for a cleaner sidebar.
- **Backup Fix**: Fixed API key settings and usage statistics being reset on backup import (column/placeholder mismatch).

## Fixes
- **API Key Creation Bug**: Fixed `createApiKey` INSERT placeholder mismatch (16 columns vs 15 `?`) that made creating any API key silently fail.
- **API Key Expiry**: Expiry date set during creation is now persisted (was silently dropped).
- **Unique Key Names**: API key names are enforced unique — server rejects duplicates and the client shows a clear message; no overwriting.
- **Duplicate API Key**: Added a Duplicate button per key that copies all settings into a new key with an auto-suggested unique name (`X (copy)`, `X (copy 2)`, …); a fresh key value is generated.

# v0.5.70-Custom (2026-09-07)

## Custom Features & Enhancements
- **API Key Quota & Limits**: Add token limit per API Key with real-time usage tracking and HTTP 429 (`API key token limit exceeded`) response upon quota exhaustion.
- **Dynamic Auto Reset Interval**: periodic usage resets (`5h`, `7d`, `14d`, `30d`, or custom like `10h`) become selectable whenever `tokenLimit > 0`.
- **Model Access Control**: API Keys can be restricted to allowed models with wildcard (`claude-*`, `gpt-*`) or exact matching, returning HTTP 403 on unauthorized calls.
- **Interactive Model Selector**: Integrated `ModelSelectModal` directly into Create & Edit API Key forms, allowing users to pick allowed models visually (same UI as Combo creation) without manual typing.
- **Key Editing & Management**: key names, token limits, reset intervals, and allowed models stay editable anytime, with a manual `restart_alt` button to zero the used tokens.
- **UI & Theme Sync**: the app is locked to dark mode with theme and language switchers removed, and custom select dropdowns now follow the app theme.

# v0.5.100 (2026-09-18)

## Features
- **Xiaomi MiMo**: merge MiMo Desktop support into `xiaomi-mimo` with dual auth (API key + Desktop/OAuth session), Preview models support, and encrypted-callback OAuth flow
- **Claude Code**: add 1M-context toggle (`[1m]` marker) and drive `CLAUDE_CODE_AUTO_COMPACT_WINDOW` directly from the dashboard
- **Models**: add DeepSeek-V4.1-Flash to DeepSeek provider, CodeBuddy-Intl, and Ollama (`deepseek-v4.1-flash:cloud`); enable `low`..`max` reasoning effort levels and vision capability for DeepSeek-V4.*
- **i18n**: integrate Persian (fa) translation

## Fixes
- **OpenCode / OpenCode Go**: resolve 403 `FreeTierError` and 429 rate limits with canonical session format, valid User-Agent, and stable upstream session reuse; force stream and declare `forceStream` for free-tier SSE aggregation; cloak decoy tools, normalize Muse Free tool choice, and strip prior reasoning items on Responses models; route Union Alpha via Messages API
- **Kiro**: preserve underscores in tool names (`mcp__server__tool`) and restore client tool names in responses; use neutral placeholder for tool-result-only turns; forward tool-result images
- **Stream**: report aborts after HTTP 200 in-band (per-format error frames) instead of closing silently
- **Command Code**: preserve images and `reasoning_effort` on `/alpha/generate`; retry transient stream errors and avoid fake stop chunks; add Quota Tracker support
- **Zed**: harden OAuth lifecycle (preserve `systemId`, renew proxy timeout), support live model resolution, and lower display priority in OAuth list
- **Antigravity**: scope cached thought signatures to model family; strip Claude Code billing headers from system prompts; sanitize Hermes system identity
- **Codex**: route bare `codex-auto-review` requests to the Codex provider (#4135)
- **Auth**: do not cool down an account for request-scoped 4xx errors
- **Usage**: improve DeepSeek credit balance display as currency credit instead of 0/total quota bar
- **Model Catalog**: scope synced catalog to gateways and declare vision capabilities for DeepSeek V4.1-Flash IDs

# v0.5.75 (2026-09-10)

## Features
- **Video**: add OpenRouter and Vertex AI (Veo) video generation on `/v1/videos/*` via a provider adapter layer; poll requests resolve their provider from `x-connection-id` or `?provider=`
- **Antigravity**: add weekly quota tracking (Gemini weekly / Claude & GPT weekly) and free-tier handling from `retrieveUserQuotaSummary` (#3892)
- **Codex**: add GPT Image 2.5, Flare and Sunburst image models with multi-image support; add the same ids to the OpenAI catalog
- **Qoder**: surface usage to all clients and stop inlining large attachments — images upload through `/api/v2/image/upload` like qodercli, oversized file blocks become stubs, context tier auto-escalates
- **OpenCode Go**: add newly published models (glm-5.3, kimi-k3, deepseek-flash, longcat-2.0, hy4-preview, hy3 on chat/completions; qwen3.8-max, qwen3.8-flash on `/messages`; grok-4.6, gpt-5.6-luna on Responses) and list `deepseek-v4.1-flash` first in the catalog
- **CLI tools**: group the model selector by provider with full-text search and manual custom model ID entry
- **CodeBuddy-CN**: replace `deepseek-v4-flash` with `deepseek-v4.1-flash`

## Fixes
- **Tools**: scope Claude tool type defaulting to gateways declaring `requireClaudeToolType` — the global default broke Anthropic-compatible endpoints that only accept the legacy typeless tool shape (#3905)
- **Claude**: cap re-anchored `cache_control` at the 4-marker budget so a spent budget no longer 400s and triggers a full combo failover; wrap bare single-object content turns before the mid-conversation-system fold
- **Cline / Airforce**: unwrap the `{"success":true,"data":…}` envelope on non-stream chat completions (#3644); add the live Cline/ClinePass model catalog and refresh Airforce free models
- **Cline**: stop `workos:`-prefixing ClinePass API keys (401 on every request, #2333) and add clinepass token refresh
- **Kiro**: never send a top-level `systemPrompt` (`400 REQUEST_BODY_INVALID`); route requests through current runtime surfaces (#3776)
- **Codex**: strip Unicode-property tool schema patterns the validator rejects (#3922); restore the `Version` header and single-source the CLI version
- **DeepSeek**: keep Anthropic-only tool types when forwarding to `/anthropic/v1/messages`
- **Qoder**: drop the Responses usage plumbing from shared translator/handler code, which changed token accounting for every provider, not just Qoder
- **Antigravity**: normalize contents and handle intermediate tool responses; protect the OAuth token-refresh path from Google anti-abuse rate limits (#3813)
- **Providers**: clear stale connection health state (`modelLock_*`, `backoffLevel`, `rateLimitedUntil`, `errorCode`) when a connection is re-validated (#3810, #3830); remove the duplicate `qwen` provider that shadowed `alims-intl`
- **Video / Vertex**: reject job ids and model ids that would escape the request URL path (SSRF)
- **Usage**: parse the Fable weekly limit from `limits[]` instead of fabricating a row (#3847)
- **Auth**: set a 24h `maxAge` on the dashboard session cookie

# v0.5.69 (2026-09-05)

## Features
- **Codex**: add GPT 6.0 Astra (`gpt-6-astra`) with vision, thinking and search capabilities
- **Usage**: add Claude Fable quota tracker support with weekly window normalization (`weekly fable (7d)`)
- **Dashboard**: group Antigravity Gemini and Claude quotas in Quota Tracker, prune stale hidden keys
- **OpenCode Go**: add `muse-spark-1.3-contributor` model and support parallel tool calls on Responses path (#3819)
- **Providers & Models**: align CodeBuddy-CN catalog/capabilities with server config; add GPT-5.6 Sol, Terra, Luna image aliases on Codex (#3806); refresh Qoder catalog with capability mapping and image pass-through
- **CLI tools**: replace Copilot MITM with VS Code extension setup guide
- **Gemini**: persist and replay `thoughtSignature` scoped by session namespace

## Fixes
- **Claude**: normalize adaptive auto effort (`output_config.effort`) (#3792)
- **Antigravity**: prevent Google anti-abuse rate limits during multi-account refresh (#3813)
- **Anthropic-compatible**: forward Claude beta flags to nodes fronting Anthropic (#3797)
- **Dashboard**: dynamic mode label for local/remote detection (#3801)
- **Codex**: format reset credit API errors cleanly (#3778)
- **Security**: guard cowork MCP tools probe against SSRF (#3783)
- **OpenCode Go**: track OpenCode Go quota (#3791) and send stable session headers (#3800)
- **Logger**: suppress noisy background token refresh logs
- **CLI**: export packed `.tgz` directly into workspace root instead of parent directory

# v0.5.65 (2026-09-03)

## Features
- **Fetch**: add Ollama Cloud web fetch provider
- **Gemini / Antigravity**: add Gemini 3.8 Flash support and bump IDE fingerprint to 2.11.0
- **Claude**: add Claude Fable 5.1 support (adaptive thinking with `output_config.effort`), bump Claude Code fingerprint to 2.1.258 for new-model access
- **Providers**: add client-side status filter (All / Active / Inactive / No connection) on the Providers dashboard; add max height and scroll for connection list
- **Providers & Models**: streamline tokenrouter model catalog down to 22 flagship/newest models and add missing provider icons; refresh Codebuddy-CN catalog (add hy4-preview/hy3/glm-5.3/kimi-k3-1, drop EOL glm-5.0/glm-4.7)
- **Models**: capability toggles (vision, reasoning) when adding custom models with upsert and live caps refresh
- **CLI tools**: support saving and managing custom API key presets
- **Quota**: add usage and rate-limit tracking for Groq via `x-ratelimit-*` headers
- **i18n**: complete Indonesian translation (1391 keys)

## Fixes
- **Security**: close SSRF guard bypasses in `ssrfGuard.js` (alternate IPv6 encodings, hostname trailing dots, wildcard DNS resolution check, safe redirect handling) (#3714)
- **Model markers**: strip the `[1m]` context marker Claude Code appends to model names (`claude-opus-5[1m]`) preventing model resolution failures (#3690)
- **Claude**: drop `server_tool_use` blocks carrying foreign IDs to avoid Anthropic 400 rejections; never anchor cache breakpoints on `defer_loading` tools (#3567)
- **Antigravity**: strike-break optimistic quota readings that keep 429ing by blocking the connection+model pair for 15m after 3 strikes (#3681); preserve client identity on model catalog requests (#3414)
- **Auth**: protect root `/responses` rewrite requiring API key validation in dashboardGuard
- **Chat & Docker**: return 503 Service Unavailable when all credentials are rate-limited; explicitly bundle `node-machine-id` into standalone Docker runtime image
- **OpenCode**: route Muse Spark models to `/zen/v1/responses` and declare vision support; filter inactive free model
- **Kiro**: preserve inline images as OpenAI-compatible `image_url` parts in OpenAI MITM; remove redundant top-level `systemPrompt` from payload
- **Usage**: read Responses-shape `cached_tokens` in `extractUsageFromResponse` for non-streaming traffic
- **Models**: support single model lookup with provider-prefixed IDs (e.g. `cc/claude-sonnet-5`)
- **Translator**: route Gemini thinking through `reasoning_effort` on OpenAI-compatible wire; convert `prefixItems` and ensure array items in Gemini schema sanitizer
- **UI**: apply persisted theme before first paint to prevent flash on reload; translate combo vision adapter label

# v0.5.59 (2026-08-29)

## Features
- **Search**: new web search providers — Antigravity (Google Search grounding
  on the existing OAuth account pool, citations keyed and merged by URL) and
  Xquik (X search with `x-api-key` auth, cursor pagination, credit-based
  usage), both on `POST /v1/search`. Based on #3437 by @Nautilaceae
- **Search**: ollama-search and zai-search borrow a chat provider's API key
  instead of requiring their own connection, driven by a new
  `credentialFallback` registry field. zai-search later folded into the `glm`
  provider itself so the web search page shows the shared connection
- **Models**: daily background sync of model capabilities from models.dev —
  modalities keyed by model id (majority of sources must declare one),
  context/output limits keyed by provider + model, strictly additive and
  sitting below the hand-written tables. ETag + mtime cache, 60s startup
  delay, `MODEL_CATALOG_SYNC=off` to disable
- **Models**: add GLM-5.3-Flash (1M context, natively multimodal), DeepSeek
  V4 Vision, Grok 4.5/4.6 (500k context); correct glm-4.6v/4.5v video input
  and output limits, backfill glm-4.6v on glm-cn
- **Usage**: show the Zed plan quota on the dashboard — plan, edit
  predictions, hosted model requests and billing-cycle reset; unlimited rows
  render as "N used · Unlimited"
- **Usage**: track GPT-5.3-Codex-Spark quota windows (spark_session /
  spark_weekly) from the Codex usage response (#3431)
- **Antigravity**: quota-aware routing — on 409/429 fetch live quota for the
  exact per-model resetAt and skip only the exhausted account/model pair;
  report the earliest reset when every account is blocked (#3561)
- **Antigravity**: map image `size` to the aspect-ratio model suffix (-WxH);
  add the Gemini 3.7 Flash tiers to MITM defaultModels so they show up in
  the dashboard model-mapping table
- **Dashboard**: bulk import Grok CLI accounts from JSON — paste an array or
  drag-drop multiple .json files, all OAuth connections created in a single
  call, mirroring the codex flow
- **CLI tools**: endpoint presets shared across every tool card through one
  live-resyncing store, instead of per-card localStorage copies that never
  saw each other's saved endpoints
- **Token Saver**: configurable compression timeout (`headroomTimeoutMs`) —
  the fixed 3000 ms made busy machines time out and send inconsistently
  compressed bodies, hurting prompt caching
- **i18n**: pt-BR expanded to 1132 terms

## Fixes
- **Claude Code**: add Claude Fable 5.1 and advertise Claude Code 2.1.258 in
  both the request header and billing identity; use its permanent adaptive-thinking
  mode with `output_config.effort`
- **Stream**: record usage when a client closes on the terminal event — the
  Responses API has no [DONE] sentinel, so codex closed the socket on
  `response.completed` and cancelled the reader before flush() ran its usage
  side effects; the tail now lives in a once-guarded finalizeStream(). Also
  stop logging a disconnect for every completed Responses call
- **Stream**: parse the trailing NDJSON line an Ollama stream leaves behind
  without a closing newline — the final chunk carrying `done_reason` and the
  token counts was dropped
- **Session**: read the Claude Code session id from the
  `x-claude-code-session-id` header — `metadata.user_id` is dropped by
  Responses translation, splitting one conversation across several
  `prompt_cache_key` values and missing the upstream prefix cache
- **Usage**: preserve nested `cached_tokens` — the top-level-only read
  persisted `cached_tokens: 0` for every Responses-format provider (codex,
  grok-cli, …), billing cache hits at the full input rate
- **Usage**: GLM quotas accept CREDIT_LIMIT plans and multi-interval windows
  (5h session / 7d weekly) instead of overwriting a single "session" key
- **Models**: the catalog sync no longer erases its own output — deltas were
  measured against the previous run's writes (the second run cut `providers`
  from 20 entries to 5); one vote per provider in the modality tally, ETag
  restored from file on startup, and the worker thread dropped after the
  bundler rewrote its path into a module-not-found error
- **Executor**: CommandCode returns errors as a `type:"error"` event inside
  an HTTP 200 NDJSON stream — peek the first events before committing, abort
  and return a real 4xx/5xx so combo/account fallback triggers instead of
  streaming the error text as content
- **Search**: scope failure locks on the credential-fallback path — a failing
  search locked `modelLock___all` and took the shared glm key offline for
  chat as well; locks are now attributed to the connection's owner and
  scoped to `websearch:<provider>`
- **Providers**: connection tests get a 15s AbortSignal timeout instead of
  hanging and exhausting the browser socket pool; guard undefined provider
  names on the providers page
- **Antigravity**: sanitize competing-client branding via a config-driven
  rule table (Zed's Claude-agent prompt, opencode → antigravity) — upstream
  answers 429 Quota Exhausted. Applied in the executor so the shared
  openai-to-gemini translator leaves gemini/vertex/zed untouched
- **MiniMax**: preserve images on the sourceFormat-matched OpenAI transport
  — MiniMax-M3 resolved a Claude-shaped body posted to the OpenAI endpoint,
  silently dropping `image_url` blocks (#3418)
- **Claude**: decloak tool names in same-format streaming passthrough —
  OAuth-cloaked names (CLAUDE_TOOL_SUFFIX) leaked to the client and every
  tool call was rejected as unknown
- **Tools**: default a missing `tools[].type` to "custom" on Claude-format
  requests — strict Anthropic-compatible gateways (MiniMax) reject the
  request with 400 otherwise
- **Translator**: zai thinkingFormat sends the top-level `reasoning_effort`
  object GLM-5.2+ requires — every GLM-5.x request ran at the model default
  (max); gated on GLM-5.2+ since older GLM does not read it (#2721)
- **RTK**: system prompt injection matches each target wire format
  (Chat/Responses/Claude/Gemini/Kiro) and is exact-idempotent across retries,
  so distinct prompts sharing a long prefix are no longer collapsed (#3202).
  Also set the diagnostic before the silent null return on Responses
  translation failure so the panel is no longer blank
- **OpenCode**: route muse-spark through /zen/v1/responses (it 500s on
  chat/completions), normalizing the Chat fields the Responses API rejects
  and clamping max/ultra effort to xhigh
- **CLI**: install better-sqlite3 without build tools on Node 22+ (N-API
  13.0.3 ships per-platform prebuilds, `--ignore-scripts` skips the implicit
  node-gyp build); Node < 22 stays on 12.6.2, working installs untouched
- **CLI tools**: send the API key Codex actually reads —
  `[model_providers.9router.http_headers]` instead of auth.json (which left
  every request 401 and clobbered an existing ChatGPT login); subagent model
  moved to `agents.default_subagent_model`
- **OAuth**: refresh Cline tokens with the extension JSON contract
- **Dashboard**: clamp the API key mask length — keys shorter than 8 chars
  threw RangeError and crashed the media-provider detail page
- **UI**: wait for the Material Symbols font itself before revealing icons —
  `document.fonts.ready` resolved before the 4MB woff2 even started loading,
  leaving icons blank until a second load

# v0.5.55 (2026-08-14)

## Features
- **Auth**: native SAML 2.0 SSO alongside OIDC — AuthnRequest generation, ACS
  assertion handling, SP metadata export, admin config test, replay-protected
  via a `saml_state` cookie matched against `InResponseTo`
- **Providers**: add Alibaba Token Plan (`token-plan.ap-southeast-1`) — the
  fourth Alibaba key type, Singapore-only and OpenAI-compatible transport only
- **Providers**: add `glm-5.3` to GLM Coding and GLM (China)
- **Providers**: Kimchi accepts API keys as well as OAuth (dual auth), with a
  working Test Connection for both modes
- **Antigravity**: add Gemini 3.7 Flash and its tiered high/medium/low variants
  (also in the Gemini registry) with pricing and quota tracking
- **TTS**: add Fish Audio — model id travels in an HTTP `model` header, voice
  is a `reference_id` (preset or cloned voice model)
- **OpenCode-Go**: route by request format via declared transports instead of
  forcing every client into `/messages` — Codex/OpenAI clients no longer pay a
  lossy Responses→OpenAI→Claude double translation. Per-model `supportedFormats`
  guard; the bespoke executor is gone (its shared `_lastModel` cache could cross
  auth headers between concurrent requests)
- **Usage**: dedup + cache Claude quota calls (120s TTL keyed by access token,
  in-flight promise dedup, last-good read on soft failure) to stop multiple
  tabs tripping 429; manual refresh (↻) sends `force=1` to bypass the cache

## Fixes
- **Docker**: ship `sql.js` in the image so the pure-JS DB fallback can start —
  file tracing carried the package's JS without `dist/sql-wasm.wasm`, so a
  container with no native driver aborted with ENOENT and never got a database
  (#3248)
- **Usage**: read Gemini `usageMetadata` out of the antigravity `{ response }`
  envelope — every non-streaming antigravity request logged `IN 0 | OUT 0`
  (#3260)
- **Claude**: re-anchor passthrough cache breakpoints — the client's own
  `cache_control` markers point at pre-normalization offsets, so the tail was
  re-cached every request. Last system block and last tool pinned at 1h TTL,
  last assistant turn at 5m, mid-conversation system messages folded into the
  neighbouring user turn instead of hoisted into `body.system`
- **Combos**: detect images from Hermes and attachment payloads (`images[]`,
  `experimental_attachments`, message-level `image_url`/`audio_url`, inline
  `data:` URIs) so the Vision Adapter auto-switch fires for Hermes/Ollama/
  Vercel AI SDK shapes
- **Kiro**: intercept chat via `x-amz-target` — Kiro IDE 1.0.228+ moved
  `GenerateAssistantResponse` to `POST /` + header, bypassing MITM. Also emit
  the now-mandatory initial-response frame and map the `auto` model slot
- **Kiro**: report real output tokens and stop discarding usable turns
- **Qoder**: detect billing blocks at stream start and return a synthetic 403
  so combo/account fallback triggers instead of leaking the error into chat
- **Antigravity**: strip competitive system prompts (Zed IDE's Claude-agent
  prompt) that Antigravity flags with a 429 Quota Exhausted
- **OpenCode**: send the official client fingerprint on free-tier requests so
  the Console stops classifying traffic as unidentified and rate-limiting it;
  session id resolves conversation-stable to preserve prompt caching
- **Responses**: don't close the message on an empty `tool_calls` array — some
  providers attach one to every chunk, and the truthy check ended the message
  on the first content token (#3234)
- **Translator**: preserve `prompt_cache_key` when converting chat to responses
- **Models**: expose snake_case token limits on `/v1/models`
- **Combos**: strip `stream_options` from the Fusion panel fan-out to avoid a
  DeepSeek 400 (#3024); raise the dashboard model-test probe budget to 1024 and
  soft-pass reasoning-only responses (#3010)
- **Headroom**: the toggle reflects the `headroomEnabled` setting even when the
  proxy is down — it previously showed OFF while the engine kept calling
  `/v1/compress`; proxy status stays visible via the status chip
- **Hermes**: add the `api_key` parameter to the model block in YAML config
- **Providers**: add llm7 to provider test support

## Docs
- **i18n**: add Spanish, French, and Brazilian Portuguese README translations

## Security
- **Real IP**: `x-9r-real-ip` and the Host fallback were trusted from
  client-controlled headers whenever `custom-server.js` was not in the request
  path (`npm run start`, `start:bun`), letting a remote caller pose as local to
  skip API key auth and reach `LOCAL_ONLY_PATHS` (`/api/mcp/*`,
  `/api/tunnel/enable`, `/api/auth/reset-password`). The server now stamps a
  per-process `x-9r-peer-token` on every request it sanitizes and only trusts
  `x-9r-real-ip` behind it — falling back to Host in development and failing
  closed in production (GHSA-pjm4-8fpg-f9p6). Also fixes IPv6 loopback
  detection (`::1`, `::ffff:127.0.0.1`) and routes `npm run start` /
  `start:bun` through `custom-server.js`
- **Search**: `resolveBaseUrl()` rejects client-supplied non-public baseUrls
  (SSRF guard on `/v1/search`)
- **Login**: fresh-install remote login with the default password returns 403
  without issuing a JWT
- **Usage**: `/api/usage/request-details` redacts request/response payloads

# v0.5.50 (2026-08-05)

## Features
- **Providers**: add TokenRouter (300+ models via OpenAI-compatible gateway) with
  exact per-model pricing for 110 models and `reasoning_effort` thinking config
- **Providers**: add Self-hosted STT / TTS / Embedding — point 9Router at your own
  OpenAI-compatible speech and embedding servers (whisper.cpp, faster-whisper,
  Kokoro-FastAPI, llama-server, vLLM, Infinity). Unlike the named cloud providers
  these read `baseUrl` per connection, so one provider can front several machines
- **Combos**: default-enable vision/audio capacity adapter (auto-routes to a
  vision/audio-capable model when the target lacks that capability, falling back
  to `oc/mimo-v2.5-free`), wired into chat handler routing
- **Endpoint**: auto-provision a "Default Key" for first-time users so `/v1`
  works without a manual dashboard step
- **Codex**: support GPT-5.6 Max/Ultra reasoning-level overrides (cx/ routes only)
- **Qoder**: support PAT (Personal Access Token) connections end-to-end, alongside
  OAuth device flow
- **CLI tools**: add OpenDesign (manalkaff/opendesign) support
- **Headroom**: report effective payload savings (tool schema/history bytes broken
  out, byte-savings % reflects actual outbound reduction)
- **Ollama**: Cloud quota tracker (session + weekly) + proactive background OAuth
  token refresh scheduler for all providers

## Fixes
- **Providers**: remove Qwen (OAuth flow stopped working reliably)
- **Passthrough**: detect codex-tui/Codex Desktop as native Codex client — they
  were falling through to the translator and losing fields like `reasoning.summary`
- **OAuth**: scope antigravity header fixes to loadCodeAssist/onboardUser only
- **OAuth**: keep `open` external in the build so xAI/Grok token refresh works on
  Windows
- **OAuth**: declare missing `searchParams` in register-session handler (was a
  500 instead of JSON on error)
- **DB**: `ENABLE_REQUEST_LOGS` env var now overrides the UI setting correctly;
  observability defaults to off (opt-in)
- **Translator**: preserve Codex Responses Lite tool use across chat-native
  OpenAI-compatible providers
- **Translator**: don't drop image-only user messages in `prepareClaudeRequest`
- **Translator**: drop JSON Schema keywords Gemini rejects (`uniqueItems`,
  `contains`, `multipleOf`, `unevaluatedProperties`, `unevaluatedItems`,
  `contentSchema`)
- **Claude**: remove global header cache that leaked one client's identity
  headers onto another client/account sharing the server; gate `anthropic-beta`
  by model instead
- **Antigravity**: drop retired Gemini 3.0 quota tiers, show Gemini 3.6 Flash
  usage bars
- **Cloudflare AI**: declare API key authentication (dashboard showed "No
  connections" despite an active key)
- **GitHub Copilot**: hold monthly-exhausted accounts until UTC month reset
  instead of only cooling down 120s
- **CodeBuddy**: dodge Tencent CN content filter, add usage tracking, normalize
  codebuddy-intl messages
- **Usage**: stop losing cached prompt tokens in the forced-SSE→JSON path
- **Grok CLI**: display the public subscription tier from the OAuth token claim
- **Providers**: count apikey connections for Ollama free-tier card; free-tier/
  apikey providers without `authModes` now default to apikey (were treated
  oauth-only)
- **Build**: include static/public assets in standalone output (login page hung
  on 404s when run via PM2)
- **Server**: support IntelliJ IDEA OpenAI-compatible clients over HTTP (h2c
  upgrade handling)
- **Auth**: redirect already-logged-in sessions away from `/login`
- **CLI tools**: enable Apply button for dynamic OpenAI/Anthropic-compatible
  provider connections
- **CLI**: include complete API artifacts in the CLI package
- **TTS**: a bare self-hosted model name is the MODEL, not the voice — `kokoro`
  was parsed as a voice against a default model, 404ing or synthesising with the
  wrong one
- **Embeddings**: self-hosted embeddings no longer fall back to `api.openai.com`
  when a connection has no `baseUrl` — that silently sent the input text and API
  key to OpenAI under a provider named "Self-hosted"
- **Embeddings**: an adapter that rejects a misconfigured connection now returns
  400 with the reason instead of escaping the handler uncaught
- **Embeddings**: bound the upstream fetch with `FETCH_CONNECT_TIMEOUT_MS` — an
  endpoint that drops packets never returns headers, so the request previously
  hung indefinitely

## Docs
- **i18n**: fix port typo, add RTK Token Saver feature descriptions

# v0.5.45 (2026-07-30)

## Features
- **TTS**: add Xiaomi MiMo text-to-speech (preset voices 冰糖/茉莉/苏打/白桦/Mia/Chloe/Milo/Dean, style control, language hint dropdown with Auto-detect, i18n for Style label/placeholder)
- **Providers**: add Poolside (OpenAI-compatible)
- **Providers**: add api-airforce, baidu, bazaarlink, bluesminds, kilo-gateway, llm7, morph, sambanova, tencent
- **OAuth**: zed / trae / windsurf providers + harden callback proxies
- **CLI tools**: set Claude Code max context tokens
- **Qoder**: PAT auth + refresh model list
- **Gemini**: Gemini 3.6 Flash tier routing + Gemini 3.5 Flash Lite
- **Claude**: bump default Opus to `claude-opus-5`
- **Kiro**: add Claude Opus 5 models
- **Usage**: Kimi and DeepSeek usage handlers
- **Usage**: SuperGrok weekly pool via gRPC-web

## Fixes
- **Refresh**: rotate `refresh_token` between retry attempts
- **Kiro**: canonicalize tool history and route API keys correctly
- **Kiro**: normalize dashboard thinking intensity models
- **Cursor**: stop leaking agent tool errors as text
- **Gemini**: fill empty tool schemas after `$ref` strip
- **Antigravity**: strip `stream_options` from non-stream requests
- **Jina-reader**: recover after transient errors, use JSON POST API
- **Usage**: record exact embedding tokens
- **Tunnel**: preserve successor cloudflared PID
- **Console-log**: initialize capture at server boot + prevent SSE proxy buffering
- **Dashboard**: count dual-auth, free-tier OAuth and API-key connections correctly
- **Dashboard**: flex quota rows, thin global scrollbars, no hidden-row overflow

## Docs
- **i18n**: expand pt-BR translation to 986 terms
- README: Indonesian translation

# v0.5.40 (2026-07-20)

## Features
- **i18n**: add Khmer (km) translations
- **CLI tools**: configure Grok Build subagent models
- **Kimi**: merge OAuth into dual-auth provider, add K3 / K2.7 models
- **Dashboard**: ProviderTopology flow animation

## Fixes
- **DB**: resolve better-sqlite3 parameter binding crash
- **Translator**: pass `service_tier` through OpenAI → Responses conversion
- **Kiro**: map GPT-5.6 reasoning effort fields
- **Kiro**: validate terminal streams before emitting output
- **Kiro**: map GPT reasoning effort fields
- **Codex**: current `client_version` + refresh-aware model sync
- **Alicode-intl**: split into Coding Plan + Model Studio providers
- **Cursor**: HTTP/2 AgentService support + version bump 3.12.17
- **Dashboard**: cut duplicate API/icon spam, lazy-load provider assets


# v0.5.35 (2026-07-16)

## Features
- **xAI**: Grok Imagine video generation (`/v1/videos`) + CLI
- **CLI tools**: Grok Build setup — choose separate main/general-purpose/explore/plan models and preserve each model's context window
- **GitHub Copilot**: route Claude models through Copilot's native `/v1/messages`
- **Kiro**: add GPT-5.6 model family (#2596)
- **RTK**: `X-9Router-Token-Saver` header to bypass token savers per request
- **Providers**: quota visibility settings
- **Translator**: drop temperature for all Claude models
- **i18n**: Thai (th) + Persian (fa) translations / README

## Fixes
- **Providers**: bulk-add API keys no longer overwrite existing keys (gap-fill `Key N`)
- **Anthropic**: lowercase `anthropic-version` header to prevent duplication on `/v1/messages`
- **Alicode-intl**: use DashScope compatible-mode endpoint so standard keys work
- **Grok CLI**: align Grok Build with current subscription protocol (#2590)
- **Grok CLI**: surface `expiresAt` so proactive token refresh fires (#2546)
- **Kiro**: improve direct session cache reuse
- **Models**: populate capabilities for live-catalog LLM models
- **Models**: list compatible provider models in `/v1/models`
- **Thinking**: send explicit `thinking:{type:adaptive}` alongside `output_config.effort`
- **Translator**: strip `client_metadata` when converting openai-responses → openai

## Improvements
- **Perf**: skip inactive background services on startup

## Docs
- README: Persian YouTube tutorial

# v0.5.30 (2026-07-10)

## Features
- **Perplexity**: add Agent API provider (#2492)
- **Grok CLI**: add Grok CLI / Grok Build provider with OAuth device-code flow (#2502)
- **Featherless**: add OpenAI-compatible provider presets
- **SearXNG**: configure endpoint via SEARXNG_URL env (#2499)
- **Providers**: add max thinking level for gpt-5.6-sol (#2500)
- **Headroom**: add extras detection and install UI (#2403)
- **Headroom**: activate/uninstall extras + fix interpreter detection
- **PXPipe**: PXPIPE token saver — multimodal prompt compression (#2465)
- **Proxy-Pools**: auto-rotate strategy for no-auth providers (#2409)

## Fixes
- **Cloudflare-AI**: support accountId in bulk key import (#2449)
- **DB**: backup on schema change, MCP child cleanup, codex models, usage providers OOM
- **Codex**: avoid bare-email OAuth dedup (#2477)
- **CLI**: allow staged app bundle builds (#2479)
- **Headroom**: compress Kiro conversation state (#2488)
- **Gemini-CLI**: raise output floor for thinking and add validated toolConfig (#2486)
- **GitHub**: label Copilot profiles by account identity (#2498)
- **OpenAI-to-Claude**: unwrap bare {function:{…}} tools without parent type (#2473)
- **Translator**: clamp thinking effort max->xhigh for OpenAI format (#2466)
- **RTK/find**: detect and group Windows backslash-style find output (#2448)
- **Codex**: handle fast tier and capacity SSE (#2452)
- **Volcengine-ark**: clamp Kimi max_tokens to 32768 endpoint cap
- **Antigravity**: align provider fingerprint with IDE Desktop 2.1.1 (#2389)
- **Pricing**: update Claude/Codex model rates and add new models

## Improvements
- **i18n(zh-CN)**: complete Chinese translations for all UI strings (#2436)
- **API**: caching for tunnel and version status endpoints
- **Perf**: faster dev startup and lighter bundle

# v0.5.20 (2026-07-07)

## Features
- **Thinking**: per-model thinking level picker on provider page — appends `(level)` suffix to copied model names for forced reasoning effort across all formats (openai, claude, gemini, deepseek, kimi, qwen, zai, minimax, hunyuan, step)
- **RTK**: add JS-native git-log filter (#2423)
- **Caveman**: add targeted upstream-aligned style rules (#2424)
- **i18n**: add Farsi (fa) language support (#2385)

## Fixes
- **Thinking**: strip `(level)` suffix from upstream `body.model` so providers no longer reject requests
- **Translator**: preserve developer instructions in openai-responses conversion (#2434)
- **count_tokens**: count structured Anthropic blocks (#2419)
- **Volcengine-ark**: clamp GLM-5 max_tokens to model output ceiling (#2428)
- **Kimi**: normalize reasoning_effort to backend enum (#2427)
- **Claude**: reconcile max_tokens vs thinking budget and lift per-model ceiling (#2381)
- **Kiro**: deliver system prompt natively, add Opus 4.5/4.7/4.8, tolerate dash version ids (#2366)
- **Headroom**: proxy dashboard through app (#2372)
- **MITM**: recover from stale lock file on server start

# v0.5.18 (2026-07-03)

## Features
- **Usage**: track cached tokens + correct input/output/cache cost (#2209) — hodtien
- **Codex**: show reset credit expiry details (#2290) — Rafli Ahmad Zulfikar
- **NVIDIA**: add new models and capabilities — decolua
- **ClinePass**: add provider support — sternelee

## Fixes
- **Usage**: dedupe streaming request-details log entries — Qin Li
- **Claude**: drop foreign thinking signatures in passthrough — decolua
- Prevent non-SSE stream pipe crash and cross-IdP account overwrites (#2244) — KunN-21
- **Kiro**: route IdC auth to regional CodeWhisperer surface (#2297) — Volodymyr Saakian
- **Kiro**: add Claude Sonnet 5 model support (#2264) — Edison42
- **Xiaomi-tokenplan**: region selector, key validation, multi-connection (#2251) — MiQieR
- **Translator**: strict Anthropic content block compliance (#2225) — Sahrul Ramadhan Hardiansyah
- **Kimchi**: strip reasoning_content echo to bound multi-turn input tokens — KunN-21
- **Kimchi**: bump User-Agent to kimchi/0.1.40 (#2256) — Ansh7473
- **Codebuddy-cn**: strip empty tool_calls arrays to preserve reasoning — zmf
- **Antigravity**: preserve Claude tool delta index (#2223) — Sutarto Jordan Chrisfivo
- **MITM**: generate root CA on server startup (#2228) — Sutarto Jordan Chrisfivo

# v0.5.15 (2026-06-29)

## Features
- Add Kimchi OAuth provider — Nant361
- Refine Qwen vision/video + thinking model patterns — decolua
- Opt-in Codex auto-ping quota keep-alive — Emirhan

## Fixes
- **Responses**: handle response.done terminal events (#2142) — rifuki
- **Headroom**: skip unsafe responses tool history (#2132) — Sutarto Jordan Chrisfivo
- **Translator**: map mid-conversation system message to user (claude→openai) — decolua
- **Gemini**: normalize contents to prevent 400 invalid_argument (#2192) — warelik
- **Gemini**: backfill thoughtSignature + suppress stream done sentinel — WARELIK
- **Alicode**: preserve cache_control for DashScope providers (#2069) — Rex
- **Antigravity**: strip deprecated/readOnly/writeOnly from tool schemas — iletai, Yudhistira-Official
- **CodeBuddy CN**: show bonus packs as one-time, not monthly-replenishing — whale9820
- **Kiro**: strip leaked <thinking> tags from content stream (#2158) — hamsa0x7
- **Tray**: make Windows context menu DPI-aware — Emirhan
- **Kilocode**: expose full gateway catalog in combo model picker — jellylarper
- **OpenCode**: fix Go GLM — decolua

# v0.5.12 (2026-06-26)

## Features
- Add token-saver dashboard page — decolua
- Add bulk delete for provider connections — teddytkz
- Resolve GitHub Copilot model catalog from upstream — caiqinzhou
- Add Venice AI provider — Brokenc0de
- Add Kiro external_idp import for Microsoft SSO (CLIProxyAPI) — Stevanus Pangau
- Overhaul Blackbox provider catalog + WebUI test support — suryacagur

## Fixes
- Provider thinking compatibility (DeepSeek/Gemini) — Mink Nguyen
- Stop double-counting streaming usage at source — decolua
- Usage logging dedupe to reduce stats churn — Mink Nguyen
- Prevent non-JSON SSE lines / duplicate [DONE] from breaking clients (PR #2046) — qianze
- Resolve Gemini TTS models from catalog — nguyenha935
- Support Kiro IDC (organization) token import — quanturbo
- Preserve forced streaming for JSON clients (#2031) — Joseph Yaksich
- Preserve Responses text format (Codex) — tenglong
- Support Gemini native TTS generateContent endpoint — nguyenha935
- Add missing zh-CN endpoint key label (i18n) — weimaozhen
- CodeBuddy: only send reasoning params when client requests reasoning (#2071) — Rex
- CodeBuddy CN: show one-shot bonus packs as expiring, not monthly-replenishing
- Show custom provider models in combo picker — Sapto
- Docker: add docker-compose.yml with headroom enabled by default — nitsuahlabs
- Clarify token diagnostics vs provider billing (headroom, #1998) — Sutarto Jordan Chrisfivo
- Translate openai-responses input through OpenAI for compression (#1998) — Ankit
- Kiro: report 1M context window for claude-opus-4.8 — EdisonPVE
- Avoid stale redirects after auth changes (#2100) — Emirhan
- Mark Claude Opus 4.7 (dashed id) as 1M context — Brokenc0de
- Preserve reasoning effort through Codex translations — ntdung6868
- Token-saver: full width card layout — decolua
- Antigravity: retry transient upstream failures — Sutarto Jordan Chrisfivo
- Param-support: handle strip rules without match/drop (#1960) — Joseph Yaksich
- Translator: resolve custom provider prefix in debug endpoint (#1083) — hamsa0x7

# v0.5.8 (2026-06-21)

## Features
- **Antigravity**: native image generation support (image models tagged kind:image, hiển thị trong media-providers UI)
- **CodeBuddy CN**: API key auth + credit quota tracker
- **CodeBuddy CN**: short model prefix alias "cbcn"

## Fixes
- **MiniMax-M3**: enable vision capability
- **Headroom**: support Docker sidecar proxy
- **Antigravity**: image executor fixes
- **mimo-free**: Chrome User-Agent rotation to bypass anti-abuse gate
- **cloudflare-ai**: flatten content-part arrays to string to avoid oneOf 400 (#1926)
- **Translator**: normalize tools to Anthropic-native shape for non-Anthropic providers
- **CLI**: handle Next.js 16 nested standalone output path (#1940)
- **Codex**: preserve custom tools during request normalization
- **next.config**: add new route for responses endpoint to API

# v0.5.6 (2026-06-20)

## Features
- **Ponytail**: minimalist code generation feature
- **Headroom**: proxy lifecycle management + dashboard UI (one-click start/stop, install detection, status probing, token saver, claude↔openai shape conversion)
- **CodeBuddy CN**: new OAuth provider (copilot.tencent.com) — 15-model catalog, /v2 inference, forced streaming, OpenAI-style reasoning
- **OpenCode-Go**: align models with official endpoints; route Qwen 3.7 MiniMax via /v1/messages, GLM/Kimi/DeepSeek/MiMo via /chat/completions

## Fixes
- **Anthropic-compatible validation**: use POST /v1/messages (GET /models not spec, false "invalid" for valid keys)
- **CLI tools**: tolerate JSONC configs in all 8 settings routes (opencode, openclaw, kilo, droid, cowork, copilot, claude, cline)
- **Gemini/Antigravity**: preserve 'pattern' in tool schema translation (glob/grep)
- **Combo/Fusion**: flatten Anthropic-style tool messages in panel calls (prevent 503)
- **Models**: store provider custom models by provider scope
- **Perplexity**: use /v1/models endpoint for key validation

# v0.5.4 (2026-06-18)

## Fixes
- **Kiro**: honor thinking effort budgets
- **AG/Kiro/Xiaomi**: provider fixes
- **Combo/Fusion**: flatten tool history in panel calls to prevent 503
- **LLM selector**: show custom vision models in selector and model list
- **Image**: prevent compatible nodes from shadowing provider aliases

# v0.5.2 (2026-06-17)

## Features
- **Combo Fusion strategy** — fans the prompt out to all member models in parallel, then a configurable judge model synthesizes one final answer (quorum-grace, anonymized sources, graceful degradation)
- **Per-combo strategy selector** — pick `fallback` / `round-robin` / `fusion` / `capacity` per combo (replaces the old round-robin toggle), with a judge picker for fusion
- **Capacity auto-switch** — reorders models per request so images/PDFs route to capable models first
- **Kiro headless API-key auth** (`ksk_`) + direct `claude↔kiro` route that avoids the lossy OpenAI two-hop pivot
- **Claude auto-ping** — warms the 5h quota window right after reset so a fresh window starts immediately (per-connection toggle)

## Fixes
- **Claude 429**: stop hammering the OAuth usage endpoint — cache resetAt, throttle quota refresh to 3 min, cool down after a 429 (chat unaffected)
- **Usage logs always empty**: missing `await` on `getAdapter()` in `getRecentLogs` made `/api/usage/logs` & `/api/usage/request-logs` return nothing
- **Executors**: strip params unsupported by the provider/model (drops deprecated `temperature` for claude-opus-4 → Anthropic 400)
- **Translator**: derive deterministic tool_call ids for gemini/antigravity → OpenAI so function call/response pair correctly (fixes tool-pairing 400s)
- **Antigravity**: strip `optional` from tool schemas before sending to Gemini
- **Claude-to-OpenAI**: handle OpenAI-format responses in the non-streaming path (e.g. xiaomi-tokenplan)
- **Usage views**: show edited connection names consistently across Providers & Quota Tracker
- **Security**: hardened reverse-proxy local-access trust
- **Security**: SSRF hardening on web fetch

## Internal
- Large **open-sse / translator refactor** (~40 commits): unified provider/model registry (LiteLLM-style `models[]` + `kind` field, 100 co-located registry files), single-sourced media/OAuth/refresh/token URLs, registry-based dispatch for usage & token-refresh, DRY translator concerns (buildUsage, encodeDataUri, finishReasonMap, chunkBuilder, reasoningDelta…), ESM-safe registry init, large-file splits, dead-code removal, and golden/no-regression test gates

# v0.4.80 (2026-06-13)

## Features
- Vercel AI Gateway: support embeddings, images and credit usage (#1183)
- Add MiMo Free no-auth provider (#1789)
- Vertex: support ADC `authorized_user` credential
- Cowork: re-enable Claude Cowork with preset-only stdio MCP
- Codex: bulk add accounts via JSON (#1719)
- Kiro: enable multi-endpoint failover for GenerateAssistantResponse (#1722)

## Fixes
- Security: re-auth on DB export/import + SSRF guard on web fetch
- Auth: real client IP rate-limiting + remote default-password guard
- Cerebras/Mistral: strip unsupported `client_metadata` from downstream requests (#1742)
- SiliconFlow: update baseUrl `.cn` -> `.com` + curate verified model list (#1760)
- Gemini-to-OpenAI: route unsigned thought parts to `reasoning_content` (#1752)
- Claude-to-OpenAI: strip Anthropic billing header from system prompt (#1765)
- Anthropic-compatible: send Bearer auth for third-party gateways (#1795)
- Usage-stats: avoid partial stats on initial SSE race (#1767)
- Proxy: use `export default` in proxy.js for Next.js 16 middleware detection
- Claude passthrough: add body normalization
- GitHub Copilot: refresh missing/expired token on models discovery (#1727) + add mappable gpt-5-mini/gpt-5.4-nano slots for Copilot MITM (#1653)
- Kiro: auto-resolve profileArn to prevent 403 on IDC login, enhance profile ARN resolution, update endpoint to `runtime.us-east-1.kiro.dev` (#1713)
- Tunnel: detect system-installed Tailscale via dual-socket probe (#1723) + non-blocking probes to prevent UI freeze
- CommandCode: force `stream=true` in transformRequest (#1706)
- Qoder: increase timeouts for reasoning models and improve stream handling
- Dashboard: show provider node name instead of connection name in topology (#1770) + show explicit `kind="llm"` combos on combos page (#1684)

## Docs
- README: add Indonesian 9Router tutorial video (#1709)

# v0.4.71 (2026-06-06)

## Features
- Caveman: add wenyan classical Chinese levels and sync upstream prompts; locale-based visibility on endpoint page
- i18n: endpoint exposure notice across multiple languages + Russian README
- Antigravity: add gemini-3.5-flash-extra-low (Low) model
- xiaomi-tokenplan: add Claude-native MiMo V2.5 Pro alias via dedicated executor
- Qoder: fetch latest model + dashboard import-model button (#1642)
- MiniMax: add MiniMax-M3 + update Quota Tracker coding/CN (#1631)

## Fixes
- Codex: harden streaming timeouts (stall/connect raised to 60s, configurable per-provider), accept `response.done` event, and always emit a terminal `response.failed` + `[DONE]` for Responses passthrough when a stream closes, stalls, or aborts before a terminal event — prevents codex clients from hanging (#1648, #1680, #1688, #1618)
- Codex: durable OAuth refresh lifecycle (#1664)
- Tunnel: skip virtual interfaces to prevent false netchange watchdog
- Claude: fix forced tool_choice 400 on cc/ OAuth route (#1592)
- Proxy: raise Next client body limit to 128MB via `NINEROUTER_PROXY_CLIENT_MAX_BODY_SIZE` (#1529, #1572)
- MiniMax: echo `reasoning_content` on follow-up turns to avoid 400 (#1543)
- Kiro: handle 400 on tool-bearing history without client tools; add mappable "auto" model slot; fix binary EventStream crash + add models & TTS tool filtering
- Antigravity: passthrough tab-autocomplete + mark default agent slot mandatory
- Qoder: allow `qmodel_latest` model key (#1638)
- Providers: restore one-connection guard for compatible/embedding nodes
- Model-test: route image/STT probes to their real endpoints, harden STT ping; add opencode-go + xiaomi-tokenplan to connection test (#1576, #1628)

## Improvements
- Dashboard: reorganize menu actions across sidebar/header/profile
- Translator: add data-driven coverage, bug-exposing cases, and real provider smoke tests

# v0.4.66 (2026-05-29)

## Features
- Add Qoder provider: device-flow OAuth, COSY signing, WAF-bypass body encoding, live model catalog, dashboard quota tracker, 11 models (#1372)
- Add new models: Claude Opus 4.8 (Claude Code), GPT 5.4 Mini (Codex)

## Fixes
- DeepSeek thinking mode: echo `reasoning_content` back on follow-up/tool-call turns so OpenCode-free and custom providers no longer 400 with "reasoning_content must be passed back" (#1543)
- Reasoning injector: match deepseek/kimi model ids case-insensitively (covers custom providers using capitalized model names)
- OpenCode suggested-models: include free models without the `-free` suffix, e.g. `big-pickle` (#1535)

## Improvements
- Codex: trim sunset models, keep gpt-5.5 / gpt-5.4 / gpt-5.3-codex family, add gpt-5.4-mini
- volcengine-ark: refresh model list (add DeepSeek-V4-Flash/Pro, drop EOL entries)
- Lower stream stall timeout 35s → 30s for faster hang detection

# v0.4.63 (2026-05-26)

## Fixes
- GitHub Copilot: never route Gemini/Claude models to the `/responses` endpoint; prevents misleading "does not support Responses API" 400s (#1062)
- proxyFetch: restore missing `Readable` import causing runtime `ReferenceError` in DNS-bypass fetch path

## Improvements
- Lower stream stall timeout from 60s → 35s for faster hang detection

# v0.4.62 (2026-05-26)

## Fixes
- Codex: auto-retry when upstream drops mid-stream (no more hangs)
- Codex: fix random 400/404 errors, tool-calling failures, and unstable prompt cache
- MITM: support Antigravity 2.x 
- Sanitize Read tool args to prevent retry loops from non-Anthropic models (#1144)
- Implement json_schema fallback for OpenAI-compatible providers without native Structured Output (#1343)
- Strip empty Read pages argument in OpenAI-to-Claude translator (#1354)
- Forward Gemini output dimensions for embeddings (#1366)
- Resolve setState-in-effect errors in dashboard components (#1362)
- Gemini CLI: reuse stored OAuth project IDs for quota checks and show clearer setup guidance when the project is missing (#1271, #1428)

## Features
- Add Cloudflare Workers proxy deployer and pool integration (#1360)
- Add Deno Deploy relays support and improved proxy pools dashboard layout (#1437)

## Improvements
- Refactor Tunnel into dedicated Cloudflare and Tailscale manager modules
- Refactor tokenRefresh service with in-flight dedup to prevent refresh_token_reused errors

# v0.4.59 (2026-05-21)

## Fixes
- OAuth: fix login flow on Windows

# v0.4.58 (2026-05-21)

## Features
- xAI Grok provider (OAuth, API key, image)
- Provider limits: paginated accounts with page size controls

## Fixes
- Tailscale: fix connection status on Windows (#1300)
- Tunnel: fix false "checking" when tunnel URL is reachable
- Stream: fix pipe errors on client disconnect/abort

# v0.4.55 (2026-05-18)

## Features
- Xiaomi MiMo Token Plan: region selector (Singapore / China / Europe) — keys are cluster-specific
- Antigravity: risk confirmation dialog before first connection
- Gemini CLI: surface upstream retry delay on 429 errors

## Fixes
- MITM: cannot kill process on macOS under sudo (lsof not found in PATH)
- Stream: false-positive stall timeout on Claude reasoning / Kiro responses
- Tunnel: cannot re-enable after disable (stuck state)
- Tunnel: cloudflared error messages now include log tail for easier debugging
- Language switcher: applies selected locale immediately on close (#1234)
- Antigravity OAuth: metadata now matches the official client

## Improvements
- Gemini CLI: bump engine to 0.34.0
- Re-hide `qwen` (OAuth EOL) and `iflow` (not ready) providers

# v0.4.52 (2026-05-17)

## Features
- Add Vercel AI Gateway provider support (#1183)
- rtk: Kiro format tool result compression — handle conversationState.history & currentMessage, preserve error results, ~13.6% savings (#1194)

## Fixes
- openclaw: normalize agent.model object form `{primary, fallbacks}` before .startsWith → fix TypeError & 'not configured' status (#1216)
- Usage Details pagination: stay inside mobile viewport <640px (#1218)
- Fix test model error
- Fix MIMO provider in Codex
- Disable log file creation when using MITM AG

# v0.4.50 (2026-05-16)

## Fixes
- Fix duplicate tray icon on macOS when hiding to tray
- Fix tray not showing in background mode on macOS
- Fix hide to tray broken on Windows/Linux
- Fix Shutdown button in web UI not working

# v0.4.49 (2026-05-16)

## Features
- Add Kiro provider support: full request/response translation, live model listing, reasoning content support
- Add `buildOutput` RTK filter with autodetect for npm/yarn/cargo build logs
- Add MITM warning notification in tray and dashboard

## Improvements
- Add modalities (input/output) to model configuration for OpenCode
- Fix tray hide-to-tray: keep current process alive instead of spawning detached child (fixes macOS NSStatusItem ghost icon)
- Fix tray kill: graceful shutdown with SIGTERM/SIGKILL escalation
- Fix SIGHUP handling so macOS terminal close doesn't kill tray process
- Hide deprecated providers (qwen, iflow, antigravity)
- Update i18n across 32 languages

## Fixes
- Fix model check (test-models) blocked by dashboardGuard: pass machineId-based CLI token in internal self-calls

# v0.4.46 (2026-05-15)

## Breaking Changes
- Tunnel public URL changed — old tunnel links no longer work, please reconnect to get the new URL
