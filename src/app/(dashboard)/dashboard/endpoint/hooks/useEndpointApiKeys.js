"use client";

import { useCallback, useState } from "react";
import {
  createKey,
  deleteKey,
  fetchKeys,
  fetchKeyUsage,
  updateKey,
} from "../services/endpointApiService";
import {
  buildLimitFormFromKey,
  buildLimitPayload,
  buildUpdatedKey,
  createDefaultLimitForm,
  normalizeLimitForm,
} from "../utils/endpointLimitHelpers";

export function useEndpointApiKeys() {
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyLimit, setNewKeyLimit] = useState(createDefaultLimitForm());
  const [createdKey, setCreatedKey] = useState(null);
  const [confirmState, setConfirmState] = useState(null);
  const [editingKey, setEditingKey] = useState(null);
  const [editKeyName, setEditKeyName] = useState("");
  const [editKeyLimit, setEditKeyLimit] = useState(createDefaultLimitForm());
  const [keyFormError, setKeyFormError] = useState("");
  const [savingKeyId, setSavingKeyId] = useState(null);
  const [loadingUsageKeyId, setLoadingUsageKeyId] = useState(null);
  const [usageDetailsByKeyId, setUsageDetailsByKeyId] = useState({});
  const [showUsageDetailsByKeyId, setShowUsageDetailsByKeyId] = useState({});
  const [keyActionStatus, setKeyActionStatus] = useState(null);
  const [visibleKeys, setVisibleKeys] = useState(new Set());

  const fetchData = useCallback(async () => {
    try {
      const { ok, data } = await fetchKeys();
      if (ok) setKeys(data.keys || []);
    } catch (error) {
      console.log("Error fetching data:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  const updateKeyInList = useCallback((id, updater) => {
    setKeys((prev) => prev.map((key) => (key.id === id ? updater(key) : key)));
  }, []);

  const resetKeyModalState = () => {
    setKeyFormError("");
    setSavingKeyId(null);
  };

  const openAddKeyModal = () => {
    setShowAddModal(true);
    setKeyFormError("");
  };

  const closeAddKeyModal = () => {
    setShowAddModal(false);
    setNewKeyName("");
    setNewKeyLimit(createDefaultLimitForm());
    setKeyFormError("");
  };

  const openEditKeyModal = (key) => {
    setEditingKey(key);
    setEditKeyName(key.name || "");
    setEditKeyLimit(buildLimitFormFromKey(key));
    setKeyFormError("");
  };

  const closeEditKeyModal = () => {
    setEditingKey(null);
    setEditKeyName("");
    setEditKeyLimit(createDefaultLimitForm());
    resetKeyModalState();
  };

  const toggleUsageDetails = async (key) => {
    const keyId = key.id;
    const currentlyOpen = !!showUsageDetailsByKeyId[keyId];
    if (currentlyOpen) {
      setShowUsageDetailsByKeyId((prev) => ({ ...prev, [keyId]: false }));
      return;
    }

    setShowUsageDetailsByKeyId((prev) => ({ ...prev, [keyId]: true }));
    if (usageDetailsByKeyId[keyId]) return;

    setLoadingUsageKeyId(keyId);
    try {
      const { ok, data } = await fetchKeyUsage(keyId, 20);
      if (!ok) {
        setKeyActionStatus({
          type: "error",
          message: data.error || "Failed to load key usage",
        });
        return;
      }
      setUsageDetailsByKeyId((prev) => ({ ...prev, [keyId]: data }));
      if (data.limitState) {
        updateKeyInList(keyId, (existingKey) =>
          buildUpdatedKey(existingKey, {}, { limitState: data.limitState }),
        );
      }
    } catch (error) {
      console.log("Error fetching key usage:", error);
      setKeyActionStatus({
        type: "error",
        message: "Failed to load key usage",
      });
    } finally {
      setLoadingUsageKeyId(null);
    }
  };

  const handleSaveKey = async () => {
    if (!editingKey) return;
    const name = editKeyName.trim();
    if (!name) {
      setKeyFormError("Key name is required");
      return;
    }

    const limitError = normalizeLimitForm(editKeyLimit);
    if (limitError) {
      setKeyFormError(limitError);
      return;
    }

    setSavingKeyId(editingKey.id);
    setKeyFormError("");

    try {
      const payload = { name, ...buildLimitPayload(editKeyLimit) };
      const { ok, data } = await updateKey(editingKey.id, payload);
      if (!ok) {
        setKeyFormError(data.error || "Failed to update key");
        return;
      }

      updateKeyInList(editingKey.id, (existingKey) =>
        buildUpdatedKey(existingKey, { name }, data.key),
      );
      setUsageDetailsByKeyId((prev) => {
        if (!prev[editingKey.id]) return prev;
        return {
          ...prev,
          [editingKey.id]: {
            ...prev[editingKey.id],
            limitState: data.key?.limitState || prev[editingKey.id].limitState,
          },
        };
      });
      setKeyActionStatus({
        type: "success",
        message: `Updated key \"${name}\"`,
      });
      closeEditKeyModal();
    } catch (error) {
      console.log("Error updating key:", error);
      setKeyFormError("Failed to update key");
    } finally {
      setSavingKeyId(null);
    }
  };

  const handleUpdateKeyActive = async (id, isActive) => {
    setSavingKeyId(id);
    try {
      const { ok, data } = await updateKey(id, { isActive });
      if (ok) {
        updateKeyInList(id, (existingKey) =>
          buildUpdatedKey(existingKey, { isActive }, data.key),
        );
      }
    } catch (error) {
      console.log("Error toggling key:", error);
    } finally {
      setSavingKeyId(null);
    }
  };

  const handleCreateKey = async () => {
    const name = newKeyName.trim();
    if (!name) {
      setKeyFormError("Key name is required");
      return;
    }

    const limitError = normalizeLimitForm(newKeyLimit);
    if (limitError) {
      setKeyFormError(limitError);
      return;
    }

    setSavingKeyId("new");
    setKeyFormError("");

    try {
      const payload = { name, ...buildLimitPayload(newKeyLimit) };
      const { ok, data } = await createKey(payload);

      if (ok) {
        setCreatedKey(data);
        await fetchData();
        setNewKeyName("");
        setNewKeyLimit(createDefaultLimitForm());
        setShowAddModal(false);
        setKeyActionStatus({
          type: "success",
          message: `Created key \"${name}\"`,
        });
      } else {
        setKeyFormError(data.error || "Failed to create key");
      }
    } catch (error) {
      console.log("Error creating key:", error);
      setKeyFormError("Failed to create key");
    } finally {
      setSavingKeyId(null);
    }
  };

  const handleDeleteKey = async (id) => {
    setConfirmState({
      title: "Delete API Key",
      message: "Delete this API key?",
      onConfirm: async () => {
        setConfirmState(null);
        try {
          const { ok } = await deleteKey(id);
          if (ok) {
            setKeys((prev) => prev.filter((k) => k.id !== id));
            setVisibleKeys((prev) => {
              const next = new Set(prev);
              next.delete(id);
              return next;
            });
          }
        } catch (error) {
          console.log("Error deleting key:", error);
        }
      },
    });
  };

  const handleToggleKey = async (id, isActive) => {
    await handleUpdateKeyActive(id, isActive);
  };

  const maskKey = (fullKey) => {
    if (!fullKey) return "";
    return fullKey.length > 8 ? fullKey.slice(0, 8) + "..." : fullKey;
  };

  const toggleKeyVisibility = (keyId) => {
    setVisibleKeys((prev) => {
      const next = new Set(prev);
      if (next.has(keyId)) next.delete(keyId);
      else next.add(keyId);
      return next;
    });
  };

  const confirmPauseKey = (key, checked) => {
    setConfirmState({
      title: "Pause API Key",
      message: `Pause API key "${key.name}"?\n\nThis key will stop working immediately but can be resumed later.`,
      onConfirm: async () => {
        setConfirmState(null);
        handleToggleKey(key.id, checked);
      },
    });
  };

  return {
    keys,
    loading,
    showAddModal,
    newKeyName,
    newKeyLimit,
    createdKey,
    confirmState,
    editingKey,
    editKeyName,
    editKeyLimit,
    keyFormError,
    savingKeyId,
    loadingUsageKeyId,
    usageDetailsByKeyId,
    showUsageDetailsByKeyId,
    keyActionStatus,
    visibleKeys,
    fetchData,
    setConfirmState,
    setNewKeyName,
    setNewKeyLimit,
    setCreatedKey,
    setEditKeyName,
    setEditKeyLimit,
    openAddKeyModal,
    closeAddKeyModal,
    openEditKeyModal,
    closeEditKeyModal,
    toggleUsageDetails,
    handleSaveKey,
    handleCreateKey,
    handleDeleteKey,
    handleToggleKey,
    maskKey,
    toggleKeyVisibility,
    confirmPauseKey,
  };
}
