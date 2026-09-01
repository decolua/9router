export const CODEX_SPARK_CONTEXT_WINDOW = 128000;
export const CODEX_SPARK_COMPACT_THRESHOLD = 100000;
export const CODEX_SPARK_MODEL_GLOB = "*gpt-5.3-codex-spark*";

export function isCodexSparkModel(model) {
  return /^gpt-5\.3-codex-spark(?:-|$)/i.test(model || "");
}
