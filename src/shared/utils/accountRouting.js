export const ACCOUNT_ROUTING_MODES = ["default", "highest", "random", "lowest"];

export const ACCOUNT_ROUTING_MODE_LABELS = {
  default: "Default",
  highest: "Highest quota",
  random: "Random",
  lowest: "Lowest quota",
};

export const ACCOUNT_ROUTING_MODE_OPTIONS = ACCOUNT_ROUTING_MODES.map((id) => ({
  id,
  label: ACCOUNT_ROUTING_MODE_LABELS[id],
}));

const LEGACY_ACCOUNT_ROUTING_MODES = {
  "fill-first": "default",
  "round-robin": "default",
  "highest-session-quota": "highest",
};

export function normalizeAccountRoutingMode(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (ACCOUNT_ROUTING_MODES.includes(raw)) return raw;
  return LEGACY_ACCOUNT_ROUTING_MODES[raw] || "default";
}

export function isKnownAccountRoutingMode(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  return ACCOUNT_ROUTING_MODES.includes(raw) || Object.prototype.hasOwnProperty.call(LEGACY_ACCOUNT_ROUTING_MODES, raw);
}
