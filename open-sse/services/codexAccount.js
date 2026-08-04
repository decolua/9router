function decodeAccountId(idToken) {
  if (typeof idToken !== "string") return "";
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1] || "", "base64url").toString("utf8"));
    return payload?.["https://api.openai.com/auth"]?.chatgpt_account_id || payload?.account_id || "";
  } catch {
    return "";
  }
}

export function resolveCodexAccountId(providerSpecificData = {}, idToken = null) {
  const values = [
    providerSpecificData?.workspaceId,
    providerSpecificData?.chatgptAccountId,
    providerSpecificData?.accountId,
    decodeAccountId(idToken),
  ];
  return values.find((value) => typeof value === "string" && value.trim())?.trim() || "";
}
