export function parseAzureDeploymentNames(names) {
  return [...new Set(names.split(",").map((name) => name.trim()).filter(Boolean))];
}

export function getAzureDeploymentPool(data) {
  return data?.deploymentMode === "pool" && Array.isArray(data.enabledModels)
    ? data.enabledModels.filter((name) => typeof name === "string" && name.trim()).map((name) => name.trim())
    : [];
}
