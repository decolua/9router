import { useState, useEffect, useCallback } from "react";
import { fetchSuggestedModels } from "@/shared/utils/providerModelsFetcher";
import {
  fetchDisabledModelsByProvider,
  disableModels,
  enableModel,
  enableAllModels,
  fetchModelAliases,
  setModelAlias,
  deleteModelAlias,
  testModelReachability,
  fetchKilocodeFreeModels,
} from "../utils/providerDetailPageApi";

export function useProviderDetailModels({
  providerId,
  providerStorageAlias,
  providerAlias,
}) {
  const [modelAliases, setModelAliases] = useState({});
  const [modelsTestError, setModelsTestError] = useState("");
  const [testingModelId, setTestingModelId] = useState(null);
  const [modelTestResults, setModelTestResults] = useState({});
  const [suggestedModels, setSuggestedModels] = useState([]);
  const [kiloFreeModels, setKiloFreeModels] = useState([]);
  const [disabledModelIds, setDisabledModelIds] = useState([]);

  const fetchDisabledModels = useCallback(async () => {
    try {
      const { res, data } =
        await fetchDisabledModelsByProvider(providerStorageAlias);
      if (res.ok) setDisabledModelIds(data.ids || []);
    } catch (error) {
      console.log("Error fetching disabled models:", error);
    }
  }, [providerStorageAlias]);

  const handleDisableModel = async (modelId) => {
    try {
      const res = await disableModels(providerStorageAlias, [modelId]);
      if (res.ok) await fetchDisabledModels();
    } catch (error) {
      console.log("Error disabling model:", error);
    }
  };

  const handleEnableModel = async (modelId) => {
    try {
      const res = await enableModel(providerStorageAlias, modelId);
      if (res.ok) await fetchDisabledModels();
    } catch (error) {
      console.log("Error enabling model:", error);
    }
  };

  const handleDisableAll = async (ids) => {
    return disableModels(providerStorageAlias, ids);
  };

  const handleEnableAll = async () => {
    try {
      const res = await enableAllModels(providerStorageAlias);
      if (res.ok) await fetchDisabledModels();
    } catch (error) {
      console.log("Error enabling all models:", error);
    }
  };

  const fetchAliases = useCallback(async () => {
    try {
      const { res, data } = await fetchModelAliases();
      if (res.ok) {
        setModelAliases(data.aliases || {});
      }
    } catch (error) {
      console.log("Error fetching aliases:", error);
    }
  }, []);

  useEffect(() => {
    if (providerId !== "kilocode") return;
    fetchKilocodeFreeModels()
      .then((data) => {
        if (data.models?.length) setKiloFreeModels(data.models);
      })
      .catch(() => {});
  }, [providerId]);

  const loadSuggestedModels = useCallback((fetcher) => {
    if (!fetcher) return;
    fetchSuggestedModels(fetcher).then(setSuggestedModels);
  }, []);

  const handleSetAlias = async (
    modelId,
    alias,
    providerAliasOverride = providerAlias,
  ) => {
    const fullModel = `${providerAliasOverride}/${modelId}`;
    try {
      const { res, data } = await setModelAlias(fullModel, alias);
      if (res.ok) {
        await fetchAliases();
      } else {
        alert(data.error || "Failed to set alias");
      }
    } catch (error) {
      console.log("Error setting alias:", error);
    }
  };

  const handleDeleteAlias = async (alias) => {
    try {
      const res = await deleteModelAlias(alias);
      if (res.ok) {
        await fetchAliases();
      }
    } catch (error) {
      console.log("Error deleting alias:", error);
    }
  };

  const handleTestModel = async (modelId) => {
    if (testingModelId) return;
    setTestingModelId(modelId);
    try {
      const { data } = await testModelReachability(
        `${providerStorageAlias}/${modelId}`,
      );
      setModelTestResults((prev) => ({
        ...prev,
        [modelId]: data.ok ? "ok" : "error",
      }));
      setModelsTestError(data.ok ? "" : data.error || "Model not reachable");
    } catch {
      setModelTestResults((prev) => ({ ...prev, [modelId]: "error" }));
      setModelsTestError("Network error");
    } finally {
      setTestingModelId(null);
    }
  };

  return {
    modelAliases,
    modelsTestError,
    testingModelId,
    modelTestResults,
    suggestedModels,
    kiloFreeModels,
    disabledModelIds,
    fetchDisabledModels,
    handleDisableModel,
    handleEnableModel,
    handleDisableAll,
    handleEnableAll,
    fetchAliases,
    loadSuggestedModels,
    handleSetAlias,
    handleDeleteAlias,
    handleTestModel,
  };
}
