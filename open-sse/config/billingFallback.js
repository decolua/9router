// Billing (HTTP 402) fallback config.
// When a paid provider returns 402 (payment_required / insufficient balance),
// chatCore retries the request against the local free-tier ollama provider
// using a mapped model. Keep mappings here — never hardcode model strings in
// handlers (CLAUDE.md: config-driven is enforced by convention).
export const BILLING_FALLBACK_PROVIDER = "ollama-local";
export const BILLING_FALLBACK_MODELS = {
  "deepseek-v4-flash": "deepseek-coder:6.7b",
};
