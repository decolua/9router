export function normalizeModelsUrl(value) {
  if (value === undefined) return undefined;
  if (value === null || String(value).trim() === "") return "";

  const url = new URL(String(value).trim());
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Models URL must use http or https");
  }
  return url.toString();
}
