export function stripKiroPrivateUsage(chunk) {
  if (!chunk?.usage || typeof chunk.usage !== "object") return chunk;
  const { kiro_credits, kiro_credit_unit, ...usage } = chunk.usage;
  if (Object.keys(usage).length === 0) {
    const { usage: _privateUsage, ...withoutUsage } = chunk;
    return withoutUsage;
  }
  return { ...chunk, usage };
}
