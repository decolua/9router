import { Button, Card } from "@/shared/components";

export default function ProviderModelsPanel({
  isCompatible,
  providerStorageAlias,
  providerDisplayAlias,
  modelAliases,
  copied,
  copy,
  handleSetAlias,
  handleDeleteAlias,
  connections,
  isAnthropicCompatible,
  models,
  kiloFreeModels,
  disabledModelIds,
  modelsTestError,
  renderModelsSection,
  handleEnableAll,
  handleDisableAll,
}) {
  const allIds = [
    ...models,
    ...kiloFreeModels.filter((fm) => !models.some((m) => m.id === fm.id)),
  ]
    .filter((m) => !m.type || m.type === "llm")
    .map((m) => m.id);
  const activeIds = allIds.filter((id) => !disabledModelIds.includes(id));

  return (
    <Card>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold">{"Available Models"}</h2>
        {!isCompatible && (
          <div className="flex gap-2">
            {disabledModelIds.length > 0 && (
              <Button
                size="sm"
                variant="secondary"
                icon="restart_alt"
                onClick={handleEnableAll}
              >
                Active All
              </Button>
            )}
            {activeIds.length > 0 && (
              <Button
                size="sm"
                variant="secondary"
                icon="block"
                onClick={() => handleDisableAll(activeIds)}
              >
                Disable All
              </Button>
            )}
          </div>
        )}
      </div>
      {!!modelsTestError && (
        <p className="mb-3 break-words text-xs text-red-500">
          {modelsTestError}
        </p>
      )}
      {renderModelsSection()}
    </Card>
  );
}
