# Dashboard Settings Foundation Design (Profile + Usage + Endpoint)

Date: 2026-04-24  
Scope: Refactor UI/structure for `dashboard/profile` and apply shared foundation to `dashboard/usage` + `dashboard/endpoint` without changing behavior or data flow.

## 1) Goals

- Refactor `dashboard/profile` to match project UI standard (shadcn preset `buFznsW`) with cleaner structure.
- Maximize reusable building blocks across dashboard settings-like pages.
- Introduce a maintainable i18n framework and migrate Profile fully, then apply to Usage + Endpoint.
- Keep all existing backend contracts, payload semantics, and user-facing behavior intact.

## 2) Non-goals

- No backend API contract changes.
- No new product features.
- No routing/business-logic redesign.
- No unrelated refactors outside Profile/Usage/Endpoint and shared settings foundation.

## 3) Current-state summary

- Profile page is currently a large client component that mixes rendering, API calls, status state, and form logic in one file.
- Usage and Endpoint pages are already active and should remain behaviorally stable.
- Existing design direction in repo favors compact flat style and Phosphor icons.

## 4) Recommended approach (selected)

Use **domain-first + incremental rollout**:

1. Build a small, stable settings foundation (shared UI primitives + shared mutation pattern + i18n namespaces).
2. Migrate `dashboard/profile` deeply (component split + hooks + full i18n text extraction).
3. Apply the same foundation to `dashboard/usage` and `dashboard/endpoint` (shared shell/section patterns + i18n integration) with minimal visual-only adjustments and no behavior changes.

Why this approach:
- Strong long-term maintainability and reuse.
- Lower regression risk than full broad rewrite.
- Clear migration checkpoints and rollback boundaries.

## 5) Architecture design

### 5.1 Shared UI foundation

Create reusable settings presentation primitives (names may vary slightly to fit repo conventions):

- `SettingsPageShell` — consistent width, section spacing, and page-level composition.
- `SettingsSectionCard` — standardized section container with icon/title/description slots.
- `SettingsFieldRow` — common label/help/control alignment for toggles/inputs.
- `SettingsStatusMessage` — consistent status rendering style for success/error/info.
- `SettingsActionBar` — standardized action buttons row (apply/test/export/import patterns).

Constraints:
- Use existing project tokens/components (`@/components/ui/*` or existing shared primitives).
- Keep Phosphor icon system.
- Avoid introducing a parallel visual system.

### 5.2 Profile page decomposition

Split current monolithic file into section components:

- `LocalModeSection`
- `SecuritySection`
- `RoutingSection`
- `NetworkSection`
- `ObservabilitySection`
- `AppInfoSection`

And extract behavior into domain hooks:

- `useProfileSettings` (core settings load/update helpers)
- `usePasswordSettings` (password form + mutation + status)
- `useProxySettings` (proxy toggle/form/test/apply)
- `useBackupSettings` (database export/import, local file handling, status)

Each section component receives state/handlers via props and stays render-focused.

### 5.3 Usage + Endpoint alignment

For `dashboard/usage` and `dashboard/endpoint`:

- Adopt shared shell/section primitives for spacing/typography/section consistency.
- Integrate i18n keys for visible text.
- Keep existing data flow, polling/live behavior, and request paths unchanged.

## 6) Data flow and behavior preservation

Behavior lock guarantees:

- Keep existing API endpoints and payload shape untouched.
- Preserve render conditions and interaction timing.
- Preserve validation semantics (e.g., password confirmation, numeric bounds behavior).
- Preserve status semantics (loading/success/error transitions) while improving consistency in presentation.

Implementation rule:
- Refactor is structural/presentational; mutation semantics are preserved exactly.

## 7) i18n framework design

### 7.1 Namespace strategy

- `dashboard.settings.common.*` for shared UI actions/labels/status templates.
- `dashboard.profile.*` for profile-specific copy.
- `dashboard.usage.*` for usage-specific copy.
- `dashboard.endpoint.*` for endpoint-specific copy.

### 7.2 Key conventions

- `section.<name>.title`
- `section.<name>.description`
- `field.<name>.label`
- `field.<name>.help`
- `field.<name>.placeholder`
- `action.<verb>`
- `status.<kind>.<event>`

### 7.3 Fallback order

1. Page namespace (`dashboard.<page>.*`)
2. Shared namespace (`dashboard.settings.common.*`)
3. Safe literal fallback (runtime guard only)

### 7.4 Rollout order

1. Full migration on Profile.
2. Apply framework + key migration to Usage.
3. Apply framework + key migration to Endpoint.

## 8) Error handling and state model

- Use a shared mutation pattern (e.g., base helper/hook) to normalize loading + status updates across sections.
- Keep error messages user-readable and aligned to new tone, mapped to i18n keys.
- Keep per-section local state isolated to avoid cross-section rerender churn.

## 9) Testing and verification strategy

- Add/update unit tests for newly extracted hooks (success/failure/loading transitions).
- Preserve and run existing usage live tests.
- Run TypeScript type-check.
- Run targeted tests for impacted unit files.
- Start dev server and manually verify golden paths on:
  - `/dashboard/profile`
  - `/dashboard/usage`
  - `/dashboard/endpoint`

Manual verification checklist:
- Toggles/forms trigger same effects as before.
- Conditional blocks appear/disappear correctly.
- Status messages render correctly for success/failure.
- No visible layout regressions under light/dark theme.

## 10) Risks and mitigations

- Risk: behavior drift during extraction.  
  Mitigation: keep handlers semantically identical; migrate section-by-section with immediate checks.
- Risk: i18n key mismatch.  
  Mitigation: enforce key naming scheme and fallback strategy.
- Risk: unintended UI changes on usage/endpoint.  
  Mitigation: limit to shell/section alignment and text binding unless required for consistency.

## 11) Deliverables

- Refactored `dashboard/profile` with section components + hooks.
- Shared settings UI foundation components.
- i18n framework and migrated keys for Profile, Usage, Endpoint.
- Updated/added tests for extracted logic.
- Verified UI behavior manually on the three pages.

## 12) Acceptance criteria

- Profile/Usage/Endpoint render with consistent settings-page design language.
- No backend contract changes and no behavior regression.
- i18n coverage exists for migrated visible text, with fallback chain in place.
- Type-check passes and impacted tests pass.
- Manual verification on three pages completed.
