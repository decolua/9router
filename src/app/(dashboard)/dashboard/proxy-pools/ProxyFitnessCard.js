import { useState, useEffect, useRef, useCallback } from "react";
import { Card, ConfirmModal } from "@/shared/components";
import { useNotificationStore } from "@/store/notificationStore";
import ProxyFitnessContent from "./ProxyFitnessContent";
import { handleMutationBarrier, optimisticProviderClear } from "./proxyFitnessHelpers";
export default function ProxyFitnessCard({ proxyPools = [] }) {
  const [isOpen, setIsOpen] = useState(false);
  const [snapshot, setSnapshot] = useState({});
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [clearing, setClearing] = useState(new Set()); // Store in-flight clear keys (scope or provider)
  const [confirmState, setConfirmState] = useState(null);
  const [now, setNow] = useState(Date.now());
  const timerRef = useRef(null);
  const fetchControllerRef = useRef(null);
  const mutationGenerationRef = useRef(0);
  const notify = useNotificationStore();

  const stopPolling = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const fetchFitness = useCallback(async () => {
    if (fetchControllerRef.current) {
      fetchControllerRef.current.abort();
    }
    const controller = new AbortController();
    fetchControllerRef.current = controller;
    const currentGeneration = mutationGenerationRef.current;

    try {
      setLoading(true);
      setFetchError(false);
      const res = await fetch("/api/proxy-pools/fitness", {
        signal: controller.signal,
        cache: "no-store",
      });
      if (res.status === 401) {
        setFetchError(true);
        // Stop polling on 401, rely on global dashboard guard behavior
        stopPolling();
        return;
      }
      if (res.ok) {
        const data = await res.json();
        setSnapshot((previous) => handleMutationBarrier(
          previous,
          data.pools || {},
          currentGeneration,
          mutationGenerationRef.current
        ));
        setFetchError(false);
      } else {
         setFetchError(true);
      }
    } catch (error) {
      if (error.name !== "AbortError") {
        console.error("Failed to fetch proxy fitness:", error);
        setFetchError(true);
      }
    } finally {
      if (fetchControllerRef.current === controller) {
        setLoading(false);
      }
    }
  }, [stopPolling]);

  const startPolling = useCallback(() => {
    stopPolling();
    timerRef.current = setInterval(() => {
      fetchFitness();
    }, 15000);
  }, [fetchFitness, stopPolling]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        stopPolling();
      } else if (isOpen && document.visibilityState === "visible") {
        fetchFitness();
        startPolling();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    if (isOpen) {
      fetchFitness();
      startPolling();
    } else {
      stopPolling();
    }
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      stopPolling();
      if (fetchControllerRef.current) fetchControllerRef.current.abort();
    };
  }, [isOpen, fetchFitness, startPolling, stopPolling]);

  // Update countdown locally every second
  useEffect(() => {
    if (!isOpen) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [isOpen]);

  const handleClearExact = async (poolId, scope) => {
    setConfirmState({
      title: "Clear Proxy Fitness",
      message: `Clear fitness exclusion for pool "${getPoolName(poolId)}" and scope "${scope}"?`,
      onConfirm: async () => {
        setConfirmState(null);
        setClearing((prev) => new Set(prev).add(`${poolId}::${scope}`));
        try {
          const res = await fetch(`/api/proxy-pools/${poolId}/fitness/clear`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ scope }),
          });
          if (res.ok) {
            // Optimistic update
            setSnapshot((prev) => {
              const next = { ...prev };
              if (next[poolId]) {
                next[poolId] = { ...next[poolId] };
                delete next[poolId][scope];
                if (Object.keys(next[poolId]).length === 0) {
                  delete next[poolId];
                }
              }
              return next;
            });
            notify.success("Cleared fitness record");
            mutationGenerationRef.current += 1;
            fetchFitness();
          } else {
            const data = await res.json().catch(() => ({}));
            notify.error(data.error || "Failed to clear fitness record");
          }
        } catch (error) {
          console.error("Error clearing fitness:", error);
          notify.error("Failed to clear fitness record");
        } finally {
          setClearing((prev) => {
            const next = new Set(prev);
            next.delete(`${poolId}::${scope}`);
            return next;
          });
        }
      }
    });
  };

  const handleClearProvider = async (provider) => {
    setConfirmState({
      title: "Clear Provider Fitness",
      message: `Clear ALL fitness exclusions for provider "${provider}" across ALL pools? This removes both the provider wildcard and all specific models.`,
      onConfirm: async () => {
        setConfirmState(null);
        setClearing((prev) => new Set(prev).add(`provider::${provider}`));
        try {
          const res = await fetch(`/api/proxy-pools/fitness/clear-all`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ provider }),
          });
          if (res.ok) {
            // Optimistic update
            setSnapshot((prev) => optimisticProviderClear(prev, provider));
            notify.success(`Cleared all fitness records for ${provider}`);
            mutationGenerationRef.current += 1;
            fetchFitness();
          } else {
            const data = await res.json().catch(() => ({}));
            notify.error(data.error || "Failed to clear provider fitness");
          }
        } catch (error) {
          console.error("Error clearing provider fitness:", error);
          notify.error("Failed to clear provider fitness");
        } finally {
          setClearing((prev) => {
            const next = new Set(prev);
            next.delete(`provider::${provider}`);
            return next;
          });
        }
      }
    });
  };

  const getPoolName = (poolId) => {
    const pool = proxyPools.find((p) => p.id === poolId);
    return pool ? pool.name : `Deleted pool (${poolId.slice(0, 8)})`;
  };

  const formatCountdown = (until) => {
    const ms = until - now;
    if (ms <= 0) return "Expired";
    const mins = Math.floor(ms / 60000);
    const secs = Math.floor((ms % 60000) / 1000);
    return `${mins}m ${secs}s`;
  };

  return (
    <>
      <Card className="mt-6 border border-gray-200 dark:border-gray-800">
        <button
          className="w-full p-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors rounded-xl text-left"
          onClick={() => setIsOpen(!isOpen)}
          aria-expanded={isOpen}
          aria-controls="proxy-fitness-content"
        >
          <div>
            <h3 className="text-lg font-medium text-gray-900 dark:text-white">Proxy Fitness</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Active temporary exclusions for proxy pools.</p>
          </div>
          <div className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
            <span className="material-symbols-outlined text-[20px]">
              {isOpen ? "expand_less" : "expand_more"}
            </span>
          </div>
        </button>

        {isOpen && (
          <div id="proxy-fitness-content" className="p-4 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/20 rounded-b-xl">
            <ProxyFitnessContent
              clearing={clearing}
              fetchError={fetchError}
              formatCountdown={formatCountdown}
              getPoolName={getPoolName}
              loading={loading}
              now={now}
              onClearExact={handleClearExact}
              onClearProvider={handleClearProvider}
              onRetry={fetchFitness}
              snapshot={snapshot}
            />
          </div>
        )}
      </Card>

      {confirmState && (
        <ConfirmModal
          isOpen={true}
          title={confirmState.title}
          message={confirmState.message}
          onConfirm={confirmState.onConfirm}
          onClose={() => setConfirmState(null)}
          confirmText="Clear"
          variant="danger"
        />
      )}
    </>
  );
}
