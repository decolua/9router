function isSafeInt(value, { min = -Number.MAX_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}

/** Request a DeepSeekHashV1 PoW challenge for `targetPath`. */
export async function requestDeepSeekPowChallenge(options) {
  const response = await fetch("https://chat.deepseek.com/api/v0/chat/create_pow_challenge", {
    method: "POST",
    headers: {
      ...options.headers,
      "Content-Type": "application/json",
      Authorization: `Bearer ${options.accessToken}`,
    },
    body: JSON.stringify({ target_path: options.targetPath }),
    signal: options.signal ?? undefined,
  });
  if (!response.ok) throw new Error(`create_pow_challenge HTTP ${response.status}`);
  const json = await response.json();
  const challenge = json?.data?.biz_data?.challenge ?? json?.biz_data?.challenge;
  const candidate = { ...challenge, target_path: options.targetPath };
  if (
    !candidate ||
    typeof candidate.algorithm !== "string" ||
    typeof candidate.challenge !== "string" ||
    typeof candidate.salt !== "string" ||
    typeof candidate.signature !== "string" ||
    !isSafeInt(candidate.difficulty, { min: 1 }) ||
    !isSafeInt(candidate.expire_at, { min: 0 }) ||
    typeof candidate.target_path !== "string"
  ) {
    throw new Error("Invalid DeepSeek PoW challenge");
  }
  return candidate;
}
