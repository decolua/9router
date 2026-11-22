// A date-only changelog still gives builds without git a coarse update signal.
// Git revisions remain the primary signal and can distinguish same-day changes.
export function releaseFromHeading(heading) {
  const text = String(heading || "").trim();
  const version = text.match(/^v\d[^\s(]*/i)?.[0];
  if (version) return version;
  const date = text.match(/^(\d{4}-\d{2}-\d{2}|\d{2}-\d{2}-\d{4})\b/)?.[1];
  if (!date) return "";
  return /^\d{2}-/.test(date) ? date.split("-").reverse().join("-") : date;
}

export function compareDateReleases(remote, local) {
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const remoteDate = datePattern.test(String(remote || ""));
  const localDate = datePattern.test(String(local || ""));
  if (!remoteDate && !localDate) return undefined;
  if (!remoteDate || !localDate) return null;
  return remote === local ? 0 : remote > local ? 1 : -1;
}
