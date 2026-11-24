const levelTag = /^\[(ERROR|WARN|INFO|LOG|DEBUG)\]\s/i;
const idTag = /(?:\brequestId\b|\bx-request-id\b)["']?\s*[:=]\s*["']?([\w-]{1,128})(?![\w-])/i;

export function filterConsole(lines, { query = "", level = "", requestId = "", limit = 200 } = {}) {
  const text = query.trim().toLowerCase(), id = requestId.trim().toLowerCase();
  return lines.flatMap(line => {
    const tag = levelTag.exec(line)?.[1]?.toLowerCase();
    const actual = !tag || tag === "log" ? "info" : tag;
    const found = idTag.exec(line)?.[1] ?? "";
    return (!level || level === actual) && (!text || line.toLowerCase().includes(text)) && (!id || found.toLowerCase().includes(id))
      ? [{ line, level: actual, requestId: found }] : [];
  }).slice(-Math.max(1, Math.min(Number(limit) || 200, 200)));
}
