const OMP_SETTINGS_ENDPOINT = "/api/cli-tools/omp-settings";

async function responseError(response, fallback) {
  try {
    const data = await response.json();
    return data?.error || fallback;
  } catch {
    return fallback;
  }
}

export async function persistOmpModelSelection({ request, previousModels, models, payload }) {
  const selected = new Set(models);
  const removed = [...new Set(previousModels)].filter((model) => !selected.has(model));

  for (const model of removed) {
    const response = await request(
      `${OMP_SETTINGS_ENDPOINT}?model=${encodeURIComponent(model)}`,
      { method: "DELETE" }
    );
    if (!response.ok) {
      throw new Error(await responseError(response, `Failed to remove ${model}`));
    }
  }

  if (models.length === 0) return;

  const response = await request(OMP_SETTINGS_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, models }),
  });
  if (!response.ok) {
    throw new Error(await responseError(response, "Failed to save Oh My Pi models"));
  }
}
