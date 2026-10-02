export const CHAT_TOOL_NAME_MAX_LENGTH = 64;
export const RESPONSES_TOOL_NAME_MAX_LENGTH = 128;

const VALID_TOOL_NAME = /^[A-Za-z0-9_-]+$/;

export function isValidToolName(name, maxLength) {
  return typeof name === "string"
    && name.length > 0
    && name.length <= maxLength
    && VALID_TOOL_NAME.test(name);
}

export function sanitizeToolName(name, maxLength) {
  if (typeof name !== "string") return "";
  return name.trim().replace(/[^A-Za-z0-9_-]/g, "_").slice(0, maxLength);
}

export function allocateToolName(name, maxLength, usedNames) {
  const base = sanitizeToolName(name, maxLength);
  if (!base) return "";

  let alias = base;
  for (let suffix = 2; usedNames.has(alias); suffix++) {
    const disambiguator = `_${suffix}`;
    alias = `${base.slice(0, maxLength - disambiguator.length)}${disambiguator}`;
  }
  usedNames.add(alias);
  return alias;
}
