export function shouldFetchCompatibleModels({
  isCompatibleProvider,
  hasExplicitEnabledModels,
  hasConfiguredCustomModels,
  skipDynamicFetch,
}) {
  return isCompatibleProvider
    && !hasExplicitEnabledModels
    && !hasConfiguredCustomModels
    && !skipDynamicFetch;
}
