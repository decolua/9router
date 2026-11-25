export const ACCOUNT_STRATEGIES = {
  "fill-first": "Fill first",
  "round-robin": "Round robin",
  "least-connections": "Fewest active requests",
  weighted: "Weighted round robin",
};
export const MIN_WEIGHT = 1;
export const MAX_WEIGHT = 100;
export const validWeight = value => Number.isInteger(value) && value >= MIN_WEIGHT && value <= MAX_WEIGHT;
