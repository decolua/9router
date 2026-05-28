"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchKeys,
  fetchKeyUsage,
  updateKey,
} from "../../endpoint/services/endpointApiService";
import {
  buildLimitFormFromKey,
  buildLimitPayload,
  buildUpdatedKey,
  createDefaultLimitForm,
  normalizeLimitForm,
} from "../../endpoint/utils/endpointLimitHelpers";

export function useKeyBudgets() {
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(null);
  const [editingKey, setEditingKey] = useState(null);
  const [editKeyLimit, setEditKeyLimit] = useState(createDefaultLimitForm());
  const [formError, setFormError] = useState("");
  const [savingKeyId, setSavingKeyId] = useState(null);
  const [expandedKeyId, setExpandedKeyId] = useState(null);
  const [usageDetailsByKeyId, setUsageDetailsByKeyId] = useState({});
  const [loadingUsageKeyId, setLoadingUsageKeyId] = useState(null);

  const loadKeys = useCallback(async () => {
    setLoading(true);
    setStatus(null);
    try {
      const { ok, data } = await fetchKeys();
      if (ok) {
        setKeys(data.keys || []);
      } else {
        setStatus({ type: "error", message: data.error || "Failed to load API keys" });
      }
    } catch {
      setStatus({ type: "error", message: "Failed to load API keys" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(loadKeys, 0);
    return () => window.clearTimeout(timer);
  }, [loadKeys]);

  const summary = useMemo(() => {
    const budgeted = keys.filter((key) => key.limitState?.enabled).length;
    const attention = keys.filter((key) =>
      ["near", "exceeded"].includes(key.limitState?.status),
    ).length;
    return {
      total: keys.length,
      budgeted,
      unlimited: keys.length - budgeted,
      attention,
    };
  }, [keys]);

  const openEditModal = useCallback((key) => {
    setEditingKey(key);
    setEditKeyLimit(buildLimitFormFromKey(key));
    setFormError("");
  }, []);

  const closeEditModal = useCallback(() => {
    setEditingKey(null);
    setEditKeyLimit(createDefaultLimitForm());
    setFormError("");
  }, []);

  const saveBudget = useCallback(async () => {
    if (!editingKey) return;
    const validationError = normalizeLimitForm(editKeyLimit);
    if (validationError) {
      setFormError(validationError);
      return;
    }

    setSavingKeyId(editingKey.id);
    setFormError("");
    try {
      const payload = buildLimitPayload(editKeyLimit);
      const { ok, data } = await updateKey(editingKey.id, payload);

      if (ok) {
        setKeys((prev) =>
          prev.map((key) =>
            key.id === editingKey.id ? buildUpdatedKey(key, {}, data.key) : key,
          ),
        );
        setUsageDetailsByKeyId((prev) => {
          const current = prev[editingKey.id];
          if (!current) return prev;
          return {
            ...prev,
            [editingKey.id]: {
              ...current,
              key: data.key || current.key,
              limitState: data.key?.limitState || current.limitState,
            },
          };
        });
        setStatus({ type: "success", message: "Budget updated" });
        closeEditModal();
      } else {
        setFormError(data.error || "Failed to update budget");
      }
    } catch {
      setFormError("Failed to update budget");
    } finally {
      setSavingKeyId(null);
    }
  }, [closeEditModal, editKeyLimit, editingKey]);

  const toggleUsageDetails = useCallback(
    async (key) => {
      if (expandedKeyId === key.id) {
        setExpandedKeyId(null);
        return;
      }

      setExpandedKeyId(key.id);
      if (usageDetailsByKeyId[key.id]) return;

      setLoadingUsageKeyId(key.id);
      try {
        const { ok, data } = await fetchKeyUsage(key.id, 5);
        if (ok) {
          setUsageDetailsByKeyId((prev) => ({ ...prev, [key.id]: data }));
          if (data.limitState) {
            setKeys((prev) =>
              prev.map((item) =>
                item.id === key.id
                  ? buildUpdatedKey(item, { limitState: data.limitState }, data.key)
                  : item,
              ),
            );
          }
        } else {
          setStatus({ type: "error", message: data.error || "Failed to load usage details" });
        }
      } catch {
        setStatus({ type: "error", message: "Failed to load usage details" });
      } finally {
        setLoadingUsageKeyId(null);
      }
    },
    [expandedKeyId, usageDetailsByKeyId],
  );

  return {
    keys,
    loading,
    status,
    summary,
    editingKey,
    editKeyLimit,
    formError,
    savingKeyId,
    expandedKeyId,
    usageDetailsByKeyId,
    loadingUsageKeyId,
    setEditKeyLimit,
    loadKeys,
    openEditModal,
    closeEditModal,
    saveBudget,
    toggleUsageDetails,
  };
}
