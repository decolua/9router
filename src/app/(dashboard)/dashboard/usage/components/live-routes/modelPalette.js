// Shared palette keeps route colors readable in both light and dark themes.
export const MODEL_PALETTE = ["#0891b2", "#059669", "#db2777", "#7c3aed", "#d97706", "#2563eb", "#e11d48"];

export function modelColor(model, models = []) {
  const index = Math.max(0, models.indexOf(model));
  return MODEL_PALETTE[index % MODEL_PALETTE.length];
}
