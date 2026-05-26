import CompatibleModelsSection from "./CompatibleModelsSection";
import ModelRow from "./ModelRow";
import ProviderModelsPanel from "./ProviderModelsPanel";

function renderModelsSection({
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
  providerInfo,
  modelTestResults,
  isFreeNoAuth,
  testingModelId,
  handleTestModel,
  handleDisableModel,
  suggestedModels,
  setShowAddCustomModel,
  handleEnableModel,
  providerId,
}) {
  if (isCompatible) {
    return (
      <CompatibleModelsSection
        providerStorageAlias={providerStorageAlias}
        providerDisplayAlias={providerDisplayAlias}
        modelAliases={modelAliases}
        copied={copied}
        onCopy={copy}
        onSetAlias={handleSetAlias}
        onDeleteAlias={handleDeleteAlias}
        connections={connections}
        isAnthropic={isAnthropicCompatible}
      />
    );
  }

  const allModels = [
    ...models,
    ...kiloFreeModels.filter((fm) => !models.some((m) => m.id === fm.id)),
  ].filter((m) => !m.type || m.type === "llm");
  const disabledSet = new Set(disabledModelIds);
  const displayModels = allModels.filter((m) => !disabledSet.has(m.id));
  const disabledDisplayModels = allModels.filter((m) => disabledSet.has(m.id));
  const customModels = Object.entries(modelAliases)
    .filter(([alias, fullModel]) => {
      const prefix = `${providerStorageAlias}/`;
      if (!fullModel.startsWith(prefix)) return false;
      const modelId = fullModel.slice(prefix.length);
      if (providerInfo.passthroughModels) {
        return !models.some((m) => m.id === modelId);
      }
      return !models.some((m) => m.id === modelId) && alias === modelId;
    })
    .map(([alias, fullModel]) => ({
      id: fullModel.slice(`${providerStorageAlias}/`.length),
      alias,
      fullModel,
    }));

  return (
    <div className="flex flex-wrap gap-3">
      {customModels.map((model) => (
        <ModelRow
          key={model.id}
          model={{ id: model.id }}
          fullModel={`${providerDisplayAlias}/${model.id}`}
          alias={model.alias}
          copied={copied}
          onCopy={copy}
          onSetAlias={() => {}}
          onDeleteAlias={() => handleDeleteAlias(model.alias)}
          testStatus={modelTestResults[model.id]}
          onTest={
            connections.length > 0 || isFreeNoAuth
              ? () => handleTestModel(model.id)
              : undefined
          }
          isTesting={testingModelId === model.id}
          isCustom
          isFree={false}
        />
      ))}

      {displayModels.map((model) => {
        const fullModel = `${providerStorageAlias}/${model.id}`;
        const oldFormatModel = `${providerId}/${model.id}`;
        const existingAlias = Object.entries(modelAliases).find(
          ([, m]) => m === fullModel || m === oldFormatModel,
        )?.[0];
        return (
          <ModelRow
            key={model.id}
            model={model}
            fullModel={`${providerDisplayAlias}/${model.id}`}
            alias={existingAlias}
            copied={copied}
            onCopy={copy}
            onSetAlias={(alias) =>
              handleSetAlias(model.id, alias, providerStorageAlias)
            }
            onDeleteAlias={() => handleDeleteAlias(existingAlias)}
            testStatus={modelTestResults[model.id]}
            onTest={
              connections.length > 0 || isFreeNoAuth
                ? () => handleTestModel(model.id)
                : undefined
            }
            isTesting={testingModelId === model.id}
            isFree={model.isFree}
            onDisable={() => handleDisableModel(model.id)}
          />
        );
      })}

      <button
        onClick={() => setShowAddCustomModel(true)}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-primary/40 px-3 py-2 text-xs text-primary transition-colors hover:border-primary hover:bg-primary/5 sm:w-auto"
      >
        <span className="material-symbols-outlined text-sm">add</span>
        Add Model
      </button>

      {suggestedModels.length > 0 &&
        (() => {
          const addedFullModels = new Set(Object.values(modelAliases));
          const hardcodedIds = new Set(models.map((m) => m.id));
          const notAdded = suggestedModels.filter(
            (m) =>
              !addedFullModels.has(`${providerStorageAlias}/${m.id}`) &&
              !hardcodedIds.has(m.id),
          );
          if (notAdded.length === 0) return null;
          return (
            <div className="mt-2 w-full">
              <p className="mb-2 text-xs text-text-muted">
                Suggested free models (≥200k context):
              </p>
              <div className="flex flex-wrap gap-2">
                {notAdded.map((m) => (
                  <button
                    key={m.id}
                    onClick={async () => {
                      const alias = m.id.split("/").pop();
                      await handleSetAlias(m.id, alias, providerStorageAlias);
                    }}
                    className="flex items-center gap-1 rounded-lg border border-black/10 px-2.5 py-1.5 text-xs text-text-muted transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary dark:border-white/10"
                    title={`${m.name} · ${(m.contextLength / 1000).toFixed(0)}k ctx`}
                  >
                    <span className="material-symbols-outlined text-[13px]">
                      add
                    </span>
                    {m.id.split("/").pop()}
                  </button>
                ))}
              </div>
            </div>
          );
        })()}

      {disabledDisplayModels.length > 0 && (
        <div className="mt-2 w-full">
          <p className="mb-2 text-xs text-text-muted">
            Disabled models ({disabledDisplayModels.length}):
          </p>
          <div className="flex flex-wrap gap-2">
            {disabledDisplayModels.map((m) => (
              <button
                key={m.id}
                onClick={() => handleEnableModel(m.id)}
                className="flex items-center gap-1 rounded-lg border border-dashed border-black/10 px-2.5 py-1.5 text-xs text-text-muted transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary dark:border-white/10"
                title="Restore model"
              >
                <span className="material-symbols-outlined text-[13px]">
                  add
                </span>
                {m.id}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ProviderModelsCard({
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
  providerInfo,
  modelTestResults,
  isFreeNoAuth,
  testingModelId,
  handleTestModel,
  handleDisableModel,
  suggestedModels,
  setShowAddCustomModel,
  handleEnableModel,
  handleEnableAll,
  handleDisableAll,
  providerId,
}) {
  return (
    <ProviderModelsPanel
      isCompatible={isCompatible}
      providerStorageAlias={providerStorageAlias}
      providerDisplayAlias={providerDisplayAlias}
      modelAliases={modelAliases}
      copied={copied}
      copy={copy}
      handleSetAlias={handleSetAlias}
      handleDeleteAlias={handleDeleteAlias}
      connections={connections}
      isAnthropicCompatible={isAnthropicCompatible}
      models={models}
      kiloFreeModels={kiloFreeModels}
      disabledModelIds={disabledModelIds}
      modelsTestError={modelsTestError}
      renderModelsSection={() =>
        renderModelsSection({
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
          providerInfo,
          modelTestResults,
          isFreeNoAuth,
          testingModelId,
          handleTestModel,
          handleDisableModel,
          suggestedModels,
          setShowAddCustomModel,
          handleEnableModel,
          providerId,
        })
      }
      handleEnableAll={handleEnableAll}
      handleDisableAll={handleDisableAll}
    />
  );
}
