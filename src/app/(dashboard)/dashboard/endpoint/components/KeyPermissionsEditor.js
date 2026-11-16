"use client";

import { useMemo, useState } from "react";
import PropTypes from "prop-types";
import { Button } from "@/shared/components";

const emptyPermissions = { providerIds: [], models: [], forceProviderId: "", forceModel: "" };

function normalized(value) {
  return {
    providerIds: Array.isArray(value?.providerIds) ? value.providerIds : [],
    models: Array.isArray(value?.models) ? value.models : [],
    forceProviderId: typeof value?.forceProviderId === "string" ? value.forceProviderId : "",
    forceModel: typeof value?.forceModel === "string" ? value.forceModel : "",
  };
}

export default function KeyPermissionsEditor({ value, onChange, providers, models, loading = false, error = "" }) {
  const permissions = normalized(value);
  const [modelToAdd, setModelToAdd] = useState("");
  const modelNames = useMemo(() => new Map(models.map((model) => [model.id, model.label])), [models]);
  const forcedProviderModels = useMemo(
    () => permissions.forceProviderId
      ? models.filter((model) => model.providerId === permissions.forceProviderId)
      : models,
    [models, permissions.forceProviderId],
  );

  const update = (next) => onChange({ ...emptyPermissions, ...next });
  const toggleProvider = (providerId) => {
    const selected = permissions.providerIds.includes(providerId);
    update({
      ...permissions,
      providerIds: selected
        ? permissions.providerIds.filter((id) => id !== providerId)
        : [...permissions.providerIds, providerId],
    });
  };
  const addModel = () => {
    if (!modelToAdd || permissions.models.includes(modelToAdd)) return;
    update({ ...permissions, models: [...permissions.models, modelToAdd] });
    setModelToAdd("");
  };

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="rounded-lg border border-border bg-sidebar/40 p-3">
        <p className="text-sm font-medium text-text-main">Access policy</p>
        <p className="mt-1 break-words text-xs leading-5 text-text-muted">
          Leave both lists empty for full access. A provider grant allows every model in that provider;
          an individual-model grant allows only that exact model. It limits what the client may request;
          it does not redirect requests.
          Scoped keys currently support chat inference and /v1/models; other services are denied.
        </p>
      </div>

      <fieldset className="min-w-0">
        <legend className="mb-2 text-sm font-medium text-text-main">Allowed providers</legend>
        {providers.length === 0 ? (
          <p className="text-sm text-text-muted">No configured providers yet.</p>
        ) : (
          <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
            {providers.map((provider) => (
              <label key={provider.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 hover:bg-sidebar">
                <input
                  type="checkbox"
                  checked={permissions.providerIds.includes(provider.id)}
                  onChange={() => toggleProvider(provider.id)}
                  className="h-4 w-4 rounded border-border accent-primary"
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm text-text-main">{provider.label}</span>
                  <span className="block break-all text-xs text-text-muted">{provider.id}</span>
                </span>
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <fieldset className="min-w-0">
        <legend className="mb-2 text-sm font-medium text-text-main">Force routing</legend>
        <p className="mb-2 break-words text-xs leading-5 text-text-muted">
          A forced model overrides any model sent by the client. A forced provider rewrites only the provider;
          the client model ID is retained. Select a provider first to see only its models below. Exact model takes precedence.
        </p>
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          <label className="min-w-0 text-xs text-text-muted">
            Force provider
            <select
              value={permissions.forceProviderId}
              onChange={(event) => {
                const forceProviderId = event.target.value;
                // A forced model must belong to the forced provider. Clear a
                // stale choice immediately instead of leaving an invalid route.
                const forceModel = forceProviderId && permissions.forceModel && !models.some(
                  (model) => model.routeId === permissions.forceModel && model.providerId === forceProviderId,
                )
                  ? ""
                  : permissions.forceModel;
                update({ ...permissions, forceProviderId, forceModel });
              }}
              className="mt-1 block min-w-0 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-text-main"
            >
              <option value="">Use requested provider</option>
              {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}
            </select>
          </label>
          <label className="min-w-0 text-xs text-text-muted">
            Enforced model
            <select
              value={permissions.forceModel}
              onChange={(event) => update({ ...permissions, forceModel: event.target.value })}
              disabled={loading || models.length === 0}
              className="mt-1 block min-w-0 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-text-main disabled:cursor-not-allowed disabled:opacity-60"
            >
              <option value="">{loading ? "Loading models…" : "Use requested model"}</option>
              {forcedProviderModels.map((model) => <option key={model.id} value={model.routeId}>{model.label}</option>)}
            </select>
            {permissions.forceProviderId && forcedProviderModels.length === 0 && (
              <span className="mt-1 block text-xs text-amber-600 dark:text-amber-400">
                {error || "No available models for this provider yet."}
              </span>
            )}
          </label>
        </div>
      </fieldset>

      <fieldset className="min-w-0">
        <legend className="mb-2 text-sm font-medium text-text-main">Allowed individual models</legend>
        <p className="mb-2 break-words text-xs leading-5 text-text-muted">
          Optional allow-list for a key. Use this when the caller may choose between specific models only;
          for example, allow model A but deny other models from the same provider. Use Enforced model above when every request must go to one model.
        </p>
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
          <select
            aria-label="Choose a model to allow"
            value={modelToAdd}
            onChange={(event) => setModelToAdd(event.target.value)}
            disabled={loading || models.length === 0}
            className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-text-main disabled:cursor-not-allowed disabled:opacity-60"
          >
            <option value="">Choose a model…</option>
            {models.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
          </select>
          <Button type="button" variant="secondary" onClick={addModel} disabled={!modelToAdd} className="w-full sm:w-auto">Add</Button>
        </div>
        {error && !permissions.forceProviderId && (
          <p className="mt-2 break-words text-xs text-amber-600 dark:text-amber-400" role="status">{error}</p>
        )}
        {permissions.models.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {permissions.models.map((modelId) => (
              <button
                type="button"
                key={modelId}
                onClick={() => update({ ...permissions, models: permissions.models.filter((id) => id !== modelId) })}
                className="max-w-full break-all rounded-full border border-primary/30 bg-primary/10 px-2 py-1 text-left text-xs text-text-main hover:bg-red-500/10 hover:text-red-600"
                title="Remove model access"
              >
                <span className="truncate">{modelNames.get(modelId) || modelId}</span> ×
              </button>
            ))}
          </div>
        )}
      </fieldset>
    </div>
  );
}

KeyPermissionsEditor.propTypes = {
  value: PropTypes.shape({
    providerIds: PropTypes.arrayOf(PropTypes.string),
    models: PropTypes.arrayOf(PropTypes.string),
    forceProviderId: PropTypes.string,
    forceModel: PropTypes.string,
  }),
  onChange: PropTypes.func.isRequired,
  providers: PropTypes.arrayOf(PropTypes.shape({ id: PropTypes.string.isRequired, label: PropTypes.string.isRequired })).isRequired,
  models: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.string.isRequired,
    routeId: PropTypes.string.isRequired,
    providerId: PropTypes.string.isRequired,
    label: PropTypes.string.isRequired,
  })).isRequired,
  loading: PropTypes.bool,
  error: PropTypes.string,
};
