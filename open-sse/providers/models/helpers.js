// Codex auto-generates a "-review" variant for each llm model (review quota family)
export const CODEX_REVIEW_SUFFIX = "-review";

export function withCodexReviewModels(models) {
  return models.flatMap((model) => {
    if ((model.kind || model.type || "llm") !== "llm" || model.id.endsWith(CODEX_REVIEW_SUFFIX)) {
      return [model];
    }
    return [
      model,
      {
        ...model,
        id: `${model.id}${CODEX_REVIEW_SUFFIX}`,
        name: `${model.name} Review`,
        upstreamModelId: model.upstreamModelId || model.id,
        quotaFamily: "review"
      }
    ];
  });
}
