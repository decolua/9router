export const BUDGET_ENDPOINT = Object.freeze({
  CHAT: "/v1/chat/completions", MESSAGES: "/v1/messages", RESPONSES: "/v1/responses",
});
const endpoints = new Set(Object.values(BUDGET_ENDPOINT));

export function budgetEndpoint(pathname) {
  const path = pathname?.replace(/^\/api\//, "/");
  return endpoints.has(path) ? path : null;
}

// Rates are integer micro-USD per million tokens; money in the ledger is micro-USD.
const positive = (n, max) => Number.isSafeInteger(n) && n > 0 && n <= max;
const fields = ["provider", "model", "tokenLimit", "costLimitMicros", "inputTokenCeiling",
  "inputRate", "outputRate", "tariffDate", "tpmLimit", "concurrencyLimit"];

export function isKeyBudget(b) {
  return b && typeof b === "object" && Object.keys(b).every(k => fields.includes(k)) &&
    typeof b.provider === "string" && /^openai-compatible-chat-[a-zA-Z0-9_-]{1,100}$/.test(b.provider) &&
    typeof b.model === "string" && /^[\w./:-]{1,160}$/.test(b.model) &&
    positive(b.tokenLimit, 1e12) && positive(b.costLimitMicros, 1e12) &&
    positive(b.inputTokenCeiling, 1e8) &&
    (b.tpmLimit == null || positive(b.tpmLimit, 1e12)) &&
    (b.concurrencyLimit == null || positive(b.concurrencyLimit, 1e6)) &&
    [b.inputRate, b.outputRate].every(n => Number.isSafeInteger(n) && n >= 0 && n <= 1e9) &&
    typeof b.tariffDate === "string" && /^\d{4}-\d\d-\d\d$/.test(b.tariffDate) &&
    Number.isFinite(Date.parse(b.tariffDate)) && new Date(b.tariffDate).toISOString().startsWith(b.tariffDate + "T");
}
