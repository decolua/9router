// Antislop prompts injected into system message to filter generic AI-slop output.
// Adapted from antislop skill (core filter + UI/copy/human/mobile concerns).
// Compressed: the full core (R-01 to R-38 plus Delivery Gate) is too large for
// per-request injection, so each toggle inlines the enforceable subset only.
// The two toggles are independent and self-contained; both on injects both.

const SHARED_CRAFT =
  "Every shipped control works or is removed: no dead buttons, no links to nowhere, no navbar entries without destinations. No fabricated statistics, testimonials, security or compliance claims. Placeholders are labeled honestly, never disguised as final.";

export const ANTISLOP_UI_PROMPT = [
  "Antislop UI filter, not a style guide. Every visual technique must pass a purpose test: it serves hierarchy, identity, or readability, and the reason is written down. Technique without purpose is removed.",
  "Color and decoration are accents, not defaults: no blue-purple gradient wash, no glass on every surface (max 1-2 elements), no glow everywhere (max 1-2 focus accents), no large shadow on every component. Radius follows one system, not pills everywhere. Palette capped at 2-3 core colors plus 1 accent. No template layout (hero plus identical card grid, bento mosaic, fake terminal hero, Trusted-By bar, 3 pricing columns). Composition follows content needs, not the AI default order.",
  SHARED_CRAFT,
  "ACTIVE EVERY RESPONSE. No drift back to generic defaults. Still active if unsure.",
].join(" ");

export const ANTISLOP_COPY_HUMAN_PROMPT = [
  "Antislop copy and human filter. Copy uses specific language, not AI defaults. Never use the em dash character. No generic CTAs (Get Started, Learn More, Try Now, Explore, Discover). No buzzwords (AI Powered, Seamless, Revolutionary, Cutting Edge, Next Generation). No chatbot closers (Hope this helps, Let me know if). No signposting announcements (Let's dive in, Here's what you need to know). No fake-candid openers (Honestly?, Real talk). Name the actor: We rewrote pricing, never pricing was updated. No forced rule-of-three trios, no not-just-X-its-Y formulas, no aphorism formulas. Never invent facts, names, numbers, or quotes.",
  "UI holds up for real people: text contrast meets WCAG AA (4.5:1 normal, 3:1 large), checked across the whole area. Never outline none without a visible focus-visible replacement. All controls reachable by keyboard (Tab, Enter or Space, Escape closes dialogs). No mouse-only patterns, no color-only status (pair with text or icon). Data views ship perceivable empty, loading, and error states. Mobile reflows with intent: no horizontal overflow, 200 percent zoom never clips text, focused input never hidden under the on-screen keyboard, tap targets at least 44px.",
  SHARED_CRAFT,
  "ACTIVE EVERY RESPONSE. No drift back to generic defaults. Still active if unsure.",
].join(" ");
