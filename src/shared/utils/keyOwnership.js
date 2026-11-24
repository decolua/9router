export const keyFieldLimits = Object.freeze({ description: 500, owner: 120, project: 120 });

// Reject the entire label rather than publishing fragments of a credential.
export function publicText(value, maxLength = 256) {
  return typeof value === "string" && value.length <= maxLength &&
    !/(?:[^\s@]+@[^\s@]+|sk-|usage:|bearer\s|:\/\/)/i.test(value) ? value : null;
}

export function publicKeyOwnership(row) {
  return Object.fromEntries(Object.entries(keyFieldLimits).map(([field, limit]) =>
    [field, publicText(row[field], limit)]));
}
