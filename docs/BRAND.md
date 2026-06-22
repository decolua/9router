# DurinDoor — Brand System

> **Source of truth** for all theme/token waves following the 9Router → DurinDoor rebrand.
> Every token wave MUST reference this document and MUST NOT contradict it.

---

## 1. Identity & Naming

**Product name:** DurinDoor  
**Tagline concept:** _Where queries find their passage_ (placeholder — final copy TBD)

### IP-Safety Statement

DurinDoor is an **original work**. The name draws on the archetype of an ancient, rune-carved
stone threshold — a motif found across many cultural traditions. This product uses **no assets,
illustrations, maps, scripts, characters, or dialogue** from any copyrighted franchise.
All visual language (icons, geometry, typography, color) is wholly original.

Specifically prohibited in any DurinDoor asset:
- Tengwar or any other copyrighted scripts
- Direct references to named fictional locations or characters under active copyright
- Reproductions or derivatives of officially licensed art
- The phrase "Speak, friend, and enter" or close paraphrases

Motif inspiration source: **original stone-arch / threshold geometry** — architectural shapes
universally associated with gates, passages, and ancient craftsmanship.

---

## 2. Color System

DurinDoor uses the dark surface / semantic token system already established in
`src/app/globals.css`. The brand layer **names** those tokens and prescribes how the new
accent palette maps onto them. No existing token is deleted; new tokens are additive.

### 2.1 Palette Map

| Brand Name      | Hex       | Existing CSS Token (dark mode)         | Role                                      |
|-----------------|-----------|----------------------------------------|-------------------------------------------|
| **Obsidian**    | `#1a1a1a` | `--color-bg`                           | Primary background — deep, near-black     |
| **Obsidian Alt**| `#1F1F1E` | `--color-bg-alt`                       | Subtle bg variation, sidebar              |
| **Charcoal**    | `#262626` | `--color-surface`                      | Card/panel surface                        |
| **Charcoal+**   | `#303030` | `--color-surface-2`                    | Elevated surface, hover states            |
| **Charcoal++**  | `#3a3a3a` | `--color-surface-3`                    | Active/pressed surface                    |
| **Stone Edge**  | `#333333` | `--color-border`                       | Default border                            |
| **Stone Faint** | `#2a2a2a` | `--color-border-subtle`                | Subtle divider                            |
| **Moon Silver** | `#ededed` | `--color-text`, `--color-text-main`    | Primary text — high-luminance on dark     |
| **Mithril**     | `#9ca3af` | `--color-text-muted`                   | Secondary / supporting text               |
| **Mithril Faint**| `#6b7280`| `--color-text-subtle`                  | Disabled, placeholder                     |
| **Forged Gold** | `#E56A4A` | `--color-brand-500`, `--color-primary` | Primary accent — calls-to-action, links   |
| **Forged Gold Dark** | `#cc5236` | `--color-brand-600`, `--color-primary-hover` | Hover / pressed accent          |

> **Light mode:** The same semantic tokens remap to warm-white surfaces (`#FDFAF6` /
> `#F7F3EE`) and near-black text (`#0a0a0a`). Forged Gold (`#E56A4A`) carries over unchanged.

### 2.2 Accent Note

The current accent is **coral-orange** (`#E56A4A`), which reads as "forged gold" in a dark,
stone-textured context. If a future wave introduces a literal amber/gold (`~#C9A84C`), that
token should be named `--color-brand-gold` and used only for decorative / motif purposes —
never as the interactive primary, to avoid confusing affordances with decoration.

### 2.3 Status Colors (unchanged from 9Router)

| Token                | Dark hex   | Light hex  | Meaning  |
|----------------------|------------|------------|----------|
| `--color-danger`     | `#ef4444`  | `#cf222e`  | Error    |
| `--color-success`    | `#22c55e`  | `#10B981`  | OK       |
| `--color-warning`    | `#fbbf24`  | `#F59E0B`  | Caution  |
| `--color-info`       | `#60a5fa`  | `#3B82F6`  | Info     |

---

## 3. Accessibility Targets

All foreground/background pairs MUST meet **WCAG 2.1 AA** (≥ 4.5:1 normal text, ≥ 3:1 large
text / UI components). Computed ratios for the primary dark-mode pairs:

| Foreground      | Background  | Ratio  | AA Normal | Notes                         |
|-----------------|-------------|--------|-----------|-------------------------------|
| Moon Silver `#ededed` | Obsidian `#1a1a1a` | **14.87:1** | PASS | Body text on page bg |
| Moon Silver `#ededed` | Charcoal `#262626` | **12.93:1** | PASS | Text on cards |
| Moon Silver `#ededed` | Charcoal+ `#303030` | **11.27:1** | PASS | Text on elevated surface |
| Mithril `#9ca3af`     | Obsidian `#1a1a1a` | **6.86:1**  | PASS | Muted text on bg |
| Mithril `#9ca3af`     | Charcoal `#262626` | **5.96:1**  | PASS | Muted text on card |
| Forged Gold `#E56A4A` | Obsidian `#1a1a1a` | **5.38:1**  | PASS | Accent on bg |
| Forged Gold `#E56A4A` | Charcoal `#262626` | **4.68:1**  | PASS | Accent on card |
| Forged Gold `#E56A4A` | Charcoal+ `#303030` | **4.08:1**  | PASS (large/UI) | Interactive badge — meets 3:1 |

Light-mode pairs:

| Foreground      | Background  | Ratio  | AA Normal |
|-----------------|-------------|--------|-----------|
| Near-black `#0a0a0a` | Warm white `#FDFAF6` | **19.03:1** | PASS |
| Forged Gold `#E56A4A` | Warm white `#FDFAF6` | **3.11:1** | PASS (large/UI) |

**Action:** Forged Gold on Charcoal+ (4.08:1) is borderline for normal-weight small text.
Use it only for badges, icons, and large labels (≥ 18 px or ≥ 14 px bold) in that context.

---

## 4. Typography

Font stack (from `--font-sans` in globals.css):

```
'Inter', -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro Display', system-ui, sans-serif
```

**DurinDoor keeps Inter as the primary UI typeface.** No display/serif is introduced for the
dashboard — this is an operational tool, not editorial. If a marketing/landing page gains a
distinct typographic identity, define it separately and keep Inter for the app shell.

### Spacing & Scale Rhythm

The existing Tailwind default scale applies. Key callouts from globals.css:

| Token              | Value  | Usage                          |
|--------------------|--------|--------------------------------|
| `--radius-brand`   | 10 px  | Standard card / input radius   |
| `--radius-brand-lg`| 14 px  | Elevated card, modal radius    |

Spacing rhythm: 4 px base unit (Tailwind default). Card padding targets `p-4` (16 px) to
`p-6` (24 px); section gaps `gap-4` to `gap-6`.

---

## 5. Motif — Stone Arch & Threshold Geometry

DurinDoor's visual language references **the archetype of a hewn-stone gateway**: clean
geometric arches, faceted edges, and recessed insets that evoke weight and permanence.

### Design Language Principles

1. **Arched headers** — section headers MAY use a subtle top-border radius that echoes an
   arch profile (no literal illustration required; radius + border is sufficient).
2. **Recessed surfaces** — inset shadows (`inset 0 1px 0 0 rgba(255,255,255,0.06)`) suggest
   depth carved into stone rather than paper stacked on paper.
3. **Faceted accents** — sharp diagonal cuts or chevron shapes (CSS clip-path) are preferred
   over soft organic blobs when decorative geometry is needed.
4. **Restrained glow** — focus rings and hover states use `rgba(229,106,74,0.18)` — a warm
   ember rather than a bright neon ring. See `--shadow-focus` in globals.css.
5. **No particle effects, no lens flares, no fantasy illustrations** — the door doesn't need
   magic; it needs weight.

### Icon Language

Material Symbols Outlined (already loaded). Supplementary icons for DurinDoor contexts:
- Gateway / access: `door_open`, `key`, `lock`, `vpn_lock`
- Network / passage: `route`, `cloud_upload`, `hub`
- Status: `check_circle`, `error`, `progress_activity` (spinner)

No custom icon font is required; the existing Material Symbols set is sufficient.

---

## 6. Shadow & Elevation System

Directly from globals.css (dark mode):

| Token               | Value summary                                    | Use               |
|---------------------|--------------------------------------------------|-------------------|
| `--shadow-soft`     | `0 1px 2px rgba(0,0,0,0.3)`                     | Subtle card lift   |
| `--shadow-warm`     | `0 2px 12px -2px rgba(229,106,74,0.25)`         | Accent card glow   |
| `--shadow-elevated` | `0 12px 28px -4px rgba(0,0,0,0.45)`             | Modal / popover    |
| `--shadow-elev`     | Inset highlight + deep drop                      | Premium card       |
| `--shadow-focus`    | `0 0 0 3px rgba(229,106,74,0.18)`               | Focus ring         |

---

## 7. Backward-Compatibility Rules

These rules are **mandatory** for every token wave that follows this document.

1. **Behavior is unchanged.** The rebrand is visual only. No routing logic, API behavior,
   model selection, or data storage is altered as part of a brand wave.

2. **`.9router` data directory read-path stays.** The application data directory
   (`~/.9router` or equivalent) MUST NOT be renamed or migrated by a brand wave. If a
   future release renames it, that requires a separate, versioned migration with user notice —
   not a side-effect of theming.

3. **`--color-primary` alias preserved.** Components reference `--color-primary` and
   `--color-primary-hover`. These aliases MUST remain in globals.css pointing to the
   active brand accent. Never remove them; remap them if the accent changes.

4. **`--color-brand-*` scale preserved.** The full 50–900 scale MUST remain. Any DurinDoor
   wave that introduces supplemental colors uses new token names (e.g. `--color-gold-*`,
   `--color-mithril-*`) rather than overwriting existing brand slots.

5. **`.card-soft`, `.card-elev`, `.bg-vibrancy` utility classes preserved.** These are
   referenced throughout the component tree. Rename only with a codemod that updates all
   callsites atomically.

6. **Theme default unchanged.** `THEME_CONFIG.defaultTheme` is `"system"` (`src/shared/constants/config.js`).
   Brand waves MUST NOT change this value or flip the default to `"dark"` or `"light"`.
   The user's OS preference and any persisted `storageKey` setting MUST continue to govern theme selection.

7. **Token waves are additive.** Each wave adds new tokens / overrides values; it NEVER
   removes a token without a deprecation period and grep-confirmed zero callsite count.

---

## 8. File Ownership

| File                      | Owner / Change process                         |
|---------------------------|------------------------------------------------|
| `src/app/globals.css`     | Token waves; changes require this doc as basis |
| `docs/BRAND.md` (this)    | Brand decisions; change via PR with designer sign-off |
| `docs/ARCHITECTURE.md`    | Structural decisions; separate concern         |

---

_Last updated: 2026-06-22 — DurinDoor rebrand wave 1 (brand doc authoring)_
