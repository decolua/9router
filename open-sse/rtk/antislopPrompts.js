// Antislop scope prompts injected into system message to filter generic AI-slop UI.
// Adapted from antislop skill (core filter + UI/copy/human/mobile concerns).
// Compressed: the full core (R-01 to R-38 plus Delivery Gate) is too large for
// per-request injection, so each scope inlines the enforceable subset only.

export const ANTISLOP_SCOPES = {
  UI: "ui",
  BALANCED: "balanced",
  FULL: "full",
};

const SHARED_FILTER =
  "Antislop UI filter, not a style guide. Every visual technique must pass a purpose test: it serves hierarchy, identity, or readability, and the reason is written down. Technique without purpose is removed.";

const SHARED_CRAFT =
  "Every shipped control works or is removed: no dead buttons, no links to nowhere, no navbar entries without destinations. No fabricated statistics, testimonials, security or compliance claims. Placeholders are labeled honestly, never disguised as final.";

const SHARED_VISUAL =
  "Color and decoration are accents, not defaults: no blue-purple gradient wash, no glass on every surface (max 1-2 elements), no glow everywhere (max 1-2 focus accents), no large shadow on every component. Radius follows one system, not pills everywhere. Palette capped at 2-3 core colors plus 1 accent. No template layout (hero plus identical card grid, bento mosaic, fake terminal hero, Trusted-By bar, 3 pricing columns). Composition follows content needs, not the AI default order.";

const SHARED_COPY =
  "Copy uses specific language, not AI defaults. Never use the em dash character. No generic CTAs (Get Started, Learn More, Try Now, Explore, Discover). No buzzwords (AI Powered, Seamless, Revolutionary, Cutting Edge, Next Generation). CTAs name the real action.";

const SHARED_HUMAN =
  "UI holds up for real people: text contrast meets WCAG AA (4.5:1 normal, 3:1 large), checked across the whole area. All controls reachable by keyboard (Tab, Enter or Space, Escape closes dialogs) with a visible focus indicator. Data views ship empty, loading, and error states. Mobile reflows with intent: no horizontal overflow, no clipped cards, tap targets at least 44px.";

const SHARED_PERSISTENCE =
  "ACTIVE EVERY RESPONSE. No drift back to generic defaults. Still active if unsure.";

export const ANTISLOP_PROMPTS = {
  [ANTISLOP_SCOPES.UI]: [
    SHARED_FILTER,
    SHARED_VISUAL,
    SHARED_CRAFT,
    SHARED_PERSISTENCE,
  ].join(" "),

  [ANTISLOP_SCOPES.BALANCED]: [
    SHARED_FILTER,
    SHARED_VISUAL,
    SHARED_COPY,
    SHARED_CRAFT,
    SHARED_PERSISTENCE,
  ].join(" "),

  [ANTISLOP_SCOPES.FULL]: [
    SHARED_FILTER,
    SHARED_VISUAL,
    SHARED_COPY,
    SHARED_HUMAN,
    SHARED_CRAFT,
    SHARED_PERSISTENCE,
  ].join(" "),
};
