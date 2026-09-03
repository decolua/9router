const TOOL_SIGNATURE_SEPARATOR = "_TSIG_";

export function buildToolCallId(name, index, thoughtSignature = "") {
  const base = `${name}-${Date.now()}-${index}`;
  if (!thoughtSignature) return base;
  const encoded = Buffer.from(thoughtSignature, "utf8").toString("base64url");
  return `${base}${TOOL_SIGNATURE_SEPARATOR}${encoded}`;
}

export function splitToolCallId(id) {
  if (typeof id !== "string") return { rawId: id, thoughtSignature: "" };
  const separator = id.indexOf(TOOL_SIGNATURE_SEPARATOR);
  if (separator === -1) return { rawId: id, thoughtSignature: "" };

  const rawId = id.slice(0, separator);
  const encoded = id.slice(separator + TOOL_SIGNATURE_SEPARATOR.length);
  try {
    return {
      rawId,
      thoughtSignature: Buffer.from(encoded, "base64url").toString("utf8"),
    };
  } catch {
    return { rawId, thoughtSignature: "" };
  }
}
