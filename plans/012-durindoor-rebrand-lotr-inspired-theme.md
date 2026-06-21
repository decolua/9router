# 012 — DurinDoor Rebrand, Documentation Rewrite, Website Refresh, and Theme Migration

## Status

TODO — roadmap plan. Execute after current stabilization branches are reviewed or explicitly folded into the integration plan. This plan is product-facing and must not be mixed into low-level stability PRs.

## Goal

Rename the project from 9Router to **DurinDoor** and align the product, docs, website, logo, favicon, and application theme around a mythic stone-gate / dwarven gateway identity inspired by the idea of Durin's Door.

The final state should feel like a premium gateway for AI connections: sturdy, ancient, carved, guarded, and reliable — without copying protected Lord of the Rings assets.

## IP and brand safety constraint

This project may reference the new name **DurinDoor** as chosen by the owner, but implementation must use original assets and original language.

Avoid:

- official LOTR logos, maps, fonts, stills, quotes, runes, inscriptions, or artwork;
- names such as Middle-earth, Moria, Khazad-dûm, Tolkien, Lord of the Rings, Rings of Power, or official character/place branding in user-facing marketing copy;
- copying the Doors of Durin illustration or inscription.

Prefer:

- original geometric stone arch motifs;
- moonlit silver linework;
- forged bronze/gold accents;
- mountain/door/gateway metaphors;
- invented non-copyrighted iconography.

STOP if the user explicitly wants official LOTR assets or text; that requires legal/product approval.

## Phase order

### Phase 0 — Brand inventory and naming map

Inventory every current 9Router/OmniRoute/OmniRoute-port mention and every brand asset.

Initial areas to inspect:

- `README.md`, `README.zh-CN.md`, `cli/README.md`, `i18n/README.*.md`
- `docs/**`, `gitbook/**`
- `package.json`, `package-lock.json`, `next.config.mjs`, `custom-server.js`
- `src/app/layout.js`, `src/app/page.js`, `src/app/landing/page.js`, `src/app/login/page.js`, `src/app/(dashboard)/**`
- `src/app/globals.css`, `src/shared/components/**`
- `public/favicon.svg`, `src/app/favicon.ico`, `public/icons/**`, any logo/icon references
- Docker, env examples, CLI metadata, generated OpenAPI metadata if present

Acceptance:

- A brand inventory report lists every file/path and whether it is copy, code identifier, package metadata, URL/API compatibility, or visual asset.
- Backwards-compatible API names are marked explicitly; do not break `/v1` compatibility or environment variables without a migration shim.

### Phase 1 — Brand system and visual direction

Create a small brand system before editing the app.

Deliverables:

- DurinDoor name usage rules.
- One-sentence positioning: "DurinDoor is a fortified AI gateway for teams running many LLM providers behind one reliable door."
- Color palette: obsidian/charcoal base, moon-silver strokes, mithril-like blue-gray highlights, warm forged-gold accents, danger/rate-limit colors preserved for accessibility.
- Typography rules using existing web-safe/project fonts only unless a new font is approved.
- Logo concept: original circular stone-door/gateway mark, symmetric geometry, no official LOTR artwork.
- Favicon/icon requirements: readable at 16/32/192/512 px, monochrome fallback.

Acceptance:

- Brand tokens are documented before CSS changes.
- Accessibility contrast targets are stated.
- Reviewer confirms no official LOTR assets or copied text.

### Phase 2 — Documentation and README rewrite

Rewrite docs for DurinDoor, not just search/replace.

Required docs:

- `README.md` — new identity, value proposition, quick start, provider setup, stability guarantees, API compatibility.
- `README.zh-CN.md` and `i18n/README.*.md` — update or mark translation follow-up.
- `docs/ARCHITECTURE.md` — update terminology around gateway/router/proxy.
- `DOCKER.md`, `.env.example`, CLI docs — preserve operational clarity.
- Any GitBook/website docs under `gitbook/**`.

Acceptance:

- A reader can understand what DurinDoor is in 30 seconds.
- Install/run commands still work.
- API compatibility with OpenAI/Anthropic remains explicit.
- No stale 9Router/OmniRoute user-facing copy remains except migration notes.

### Phase 3 — Website and landing page refresh

Refresh marketing/product surfaces.

Likely files:

- `src/app/landing/page.js`
- `src/app/page.js`
- `src/app/layout.js`
- `src/app/login/page.js`
- `public/**` assets used by landing/login

Acceptance:

- Landing page uses DurinDoor brand language and theme.
- Metadata title/description/favicon update.
- Login page and callback surfaces match the new identity.
- Screens remain responsive and accessible.

### Phase 4 — App retheme

Apply the visual system to the dashboard without breaking UX consistency.

Start with token-level changes, then components, then pages:

1. `src/app/globals.css` theme tokens.
2. Shared primitives in `src/shared/components/**`.
3. Dashboard shell/sidebar/header.
4. Cards, modals, badges, forms, tables, provider/account screens.
5. Charts/status colors only after accessibility review.

Coordinate with UI-01. Do not duplicate UI-01 work; fold DurinDoor theming into its batches where possible.

Acceptance:

- No undefined Tailwind/theme tokens.
- Light/dark behavior is deliberate.
- Modal/focus/keyboard behavior preserved.
- Visual regression screenshots or manual review notes exist for key pages.

### Phase 5 — Logo, favicon, and asset replacement

Replace assets with original DurinDoor artwork.

Files to inspect/update:

- `public/favicon.svg`
- `src/app/favicon.ico`
- `public/icons/icon-192.svg`
- `public/icons/icon-512.svg`
- any manifest/PWA metadata
- docs and README image references

Acceptance:

- SVG source is original and committed.
- ICO/PNG/icon sizes generated from the source.
- Favicon renders at small sizes.
- No old logo remains in app/docs.

### Phase 6 — Compatibility and migration layer

Decide what must remain named `9router` for compatibility.

Examples:

- npm package names or binary names may need migration aliases.
- Env vars such as `NINEROUTER_URL` may need deprecation warnings rather than immediate removal.
- API routes must remain OpenAI/Anthropic compatible.
- Docker image names may need dual tags during transition.

Acceptance:

- Existing users can upgrade without broken env/config.
- New DurinDoor names are documented.
- Deprecated names emit clear warnings only where safe.

### Phase 7 — Verification and release readiness

Run after all rebrand/theme changes are integrated.

Required checks:

```bash
npm run build
npm run lint:fatal
npx vitest run --config tests/vitest.config.js
```

Add visual checks:

- landing page
- login page
- dashboard home
- provider/account forms
- MCP gateway page
- usage/logs pages
- modal/dialog examples

Acceptance:

- Build/test/lint gates pass.
- Brand inventory has zero unresolved stale user-facing names.
- Accessibility and responsive review completed.
- Fresh reviewer confirms IP-safe original identity.

## Suggested PR slicing

1. Brand inventory + brand system doc.
2. README/docs rewrite.
3. Landing/login metadata + favicon/logo.
4. Theme tokens + shared primitives.
5. Dashboard shell/sidebar.
6. Page batches coordinated with UI-01.
7. Compatibility aliases/warnings.
8. Final stale-name sweep and visual QA.

Keep each PR under ~400 changed lines unless a chained PR plan is approved.

## STOP conditions

- Request to use official LOTR/Tolkien assets, quotes, or names.
- Rename would break existing API/env/package compatibility without migration.
- Theme change reduces contrast or keyboard accessibility.
- Rebrand PR grows too large for review.
