async function clock() {
  return globalThis.Temporal ?? (await import("temporal-polyfill")).Temporal;
}

export async function expiryInput(instant, zone) {
  if (!instant) return "";
  const T = await clock();
  return T.Instant.from(instant).toZonedDateTimeISO(zone).toPlainDateTime().toString({ fractionalSecondDigits: 3 });
}

export async function expiryInstant(local, zone, saved) {
  const T = await clock();
  const wall = T.PlainDateTime.from(local);
  // Preserve either occurrence of a repeated hour when saving an unedited value.
  if (saved && wall.equals(T.Instant.from(saved).toZonedDateTimeISO(zone).toPlainDateTime())) return saved;
  const stamp = wall.toZonedDateTime(zone, { disambiguation: "reject" }).toInstant().toString({ fractionalSecondDigits: 3 });
  if (!/^\d{4}-/.test(stamp)) throw new RangeError("Unsupported year");
  return stamp;
}
