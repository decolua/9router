export function getMediaType(contentType) {
  return String(contentType || "").split(";")[0].trim().toLowerCase();
}

export function isEventStreamContentType(contentType) {
  return getMediaType(contentType) === "text/event-stream";
}

export function isJsonContentType(contentType) {
  const mediaType = getMediaType(contentType);
  return mediaType === "application/json" || mediaType.endsWith("+json");
}
