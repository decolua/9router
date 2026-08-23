function normalizeJsonPunctuation(value) {
  return value
    .replace(/[：]/g, ":")
    .replace(/[，]/g, ",")
    .replace(/[｛]/g, "{")
    .replace(/[｝]/g, "}")
    .replace(/[［]/g, "[")
    .replace(/[］]/g, "]")
    .replace(/[“”]/g, '"');
}

function extractJsonCandidates(text) {
  const normalized = normalizeJsonPunctuation(String(text || "").trim());
  const candidates = [];
  for (const match of normalized.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) candidates.push(match[1].trim());
  candidates.push(normalized);
  const objectStart = normalized.indexOf("{");
  const objectEnd = normalized.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) candidates.push(normalized.slice(objectStart, objectEnd + 1));
  const arrayStart = normalized.indexOf("[");
  const arrayEnd = normalized.lastIndexOf("]");
  if (arrayStart >= 0 && arrayEnd > arrayStart) candidates.push(normalized.slice(arrayStart, arrayEnd + 1));
  return [...new Set(candidates.filter(Boolean))];
}

function normalizeScores(parsed) {
  const source = Array.isArray(parsed)
    ? parsed
    : parsed?.scores || parsed?.results || parsed?.evaluations || parsed?.data || [];
  let entries = Array.isArray(source) ? source : [];
  if (!entries.length && parsed && typeof parsed === "object") {
    entries = Object.entries(parsed).flatMap(([model, value]) => {
      if (["summary", "comment", "overall"].includes(model)) return [];
      return typeof value === "number" || typeof value === "string"
        ? [{ model, score: value }]
        : value && typeof value === "object" ? [{ model, ...value }] : [];
    });
  }
  const scores = entries.flatMap((item) => {
    const model = String(item?.model || item?.name || item?.id || item?.candidate || "").trim();
    const score = Number(item?.score ?? item?.rating ?? item?.value ?? item?.overall);
    if (!model || !Number.isFinite(score)) return [];
    return [{ model, score, comment: String(item?.comment || item?.reason || item?.feedback || "").trim() }];
  });
  if (!scores.length) throw new Error("裁判模型未返回有效评分");
  return {
    scores,
    summary: String(parsed?.summary || parsed?.overall?.summary || parsed?.comment || "评分完成"),
  };
}

export function parseJudgeResult(text) {
  for (const candidate of extractJsonCandidates(text)) {
    try {
      return normalizeScores(JSON.parse(candidate));
    } catch {}
  }
  throw new Error("裁判模型未返回有效评分");
}
