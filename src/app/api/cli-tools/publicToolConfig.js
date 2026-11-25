// Status endpoints read installed tool files, which may still contain a gateway
// bearer after rotation. Remove credential fields before returning nested JSON.
export function publicToolConfig(value) {
  if (Array.isArray(value)) return value.map(publicToolConfig);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([name]) => !/(api[_-]?key|auth[_-]?token|authorization|password|secret|headers|^raw$|^env$)/i.test(name))
    .map(([name, child]) => [name, publicToolConfig(child)]));
}
