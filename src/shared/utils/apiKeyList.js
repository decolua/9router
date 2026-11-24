export function keyStatus(key, now = Date.now()) {
  if (key.expiresAt && Date.parse(key.expiresAt) <= now) return "Expired";
  return key.isActive === false ? "Paused" : "Active";
}

export function filterKeys(keys, { search = "", status = "All", project = "" }, now = Date.now()) {
  const query = search.trim().toLocaleLowerCase();
  return keys.filter(key => {
    if (project && key.project !== project) return false;
    if (status === "Restricted") {
      if (!key.access?.restricted && !key.allowedConnections?.length) return false;
    } else if (status !== "All" && status !== keyStatus(key, now)) return false;
    return [key.name, key.owner, key.project, key.description].some(value =>
      String(value ?? "").toLocaleLowerCase().includes(query)
    );
  });
}

export function maskKey(value) {
  if (!value) return "";
  return value.length > 10 ? value.slice(0, 6) + "…" + value.slice(-4) : "••••";
}
