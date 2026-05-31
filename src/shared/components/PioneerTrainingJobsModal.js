"use client";

import { useState, useEffect, useCallback } from "react";
import PropTypes from "prop-types";
import { Modal, Button, Input, Select } from "@/shared/components";

const TRAINABLE_BASE_MODELS = [
  { id: "meta-llama/Llama-3.2-1B-Instruct", label: "Llama 3.2 1B Instruct" },
  { id: "meta-llama/Llama-3.1-8B-Instruct", label: "Llama 3.1 8B Instruct" },
  { id: "Qwen/Qwen2.5-Coder-0.5B", label: "Qwen2.5 Coder 0.5B" },
  { id: "google/gemma-3-4b-pt", label: "Gemma 3 4B (Pretrained)" },
  { id: "HuggingFaceTB/SmolLM3-3B-Base", label: "SmolLM3 3B Base" },
];

const STATUS_COLORS = {
  requested: "text-amber-600 dark:text-amber-400",
  running: "text-sky-600 dark:text-sky-400",
  complete: "text-emerald-600 dark:text-emerald-400",
  completed: "text-emerald-600 dark:text-emerald-400",
  succeeded: "text-emerald-600 dark:text-emerald-400",
  failed: "text-red-600 dark:text-red-400",
  stopped: "text-gray-500",
  cancelled: "text-gray-500",
};

function statusClass(status) {
  return STATUS_COLORS[String(status || "").toLowerCase()] || "text-text-muted";
}

export default function PioneerTrainingJobsModal({
  isOpen,
  onClose,
  connectionId,
  connectionName,
}) {
  const [tab, setTab] = useState("list"); // "list" | "new"
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // New-job form state
  const [modelName, setModelName] = useState("");
  const [baseModel, setBaseModel] = useState(TRAINABLE_BASE_MODELS[0].id);
  const [datasetName, setDatasetName] = useState("");
  const [trainingType, setTrainingType] = useState("lora");
  const [nrEpochs, setNrEpochs] = useState(3);
  const [learningRate, setLearningRate] = useState(0.0001);
  const [submitting, setSubmitting] = useState(false);

  const fetchJobs = useCallback(async (signal) => {
    if (!connectionId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/oauth/pioneer/training-jobs?connectionId=${encodeURIComponent(connectionId)}&limit=100`,
        { signal }
      );
      const data = await res.json();
      if (signal?.aborted) return;
      if (!res.ok || data.error) throw new Error(data.error || "Fetch failed");
      setJobs(Array.isArray(data.jobs) ? data.jobs : []);
    } catch (e) {
      if (e.name === "AbortError") return;
      setError(e.message);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [connectionId]);

  useEffect(() => {
    if (!isOpen || tab !== "list" || !connectionId) return undefined;
    const ctrl = new AbortController();
    // Schedule via microtask so setState happens outside effect body proper.
    // The actual network + state writes live inside fetchJobs.
    queueMicrotask(() => {
      if (!ctrl.signal.aborted) fetchJobs(ctrl.signal);
    });
    return () => ctrl.abort();
  }, [isOpen, tab, connectionId, fetchJobs]);

  const handleStop = async (jobId) => {
    if (!jobId) return;
    if (typeof window !== "undefined" && !window.confirm(`Stop training job ${jobId}? This cannot be undone.`)) return;
    try {
      const res = await fetch(
        `/api/oauth/pioneer/training-jobs/${encodeURIComponent(jobId)}?connectionId=${encodeURIComponent(connectionId)}`,
        { method: "DELETE" }
      );
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Stop failed");
      await fetchJobs();
    } catch (e) {
      setError(e.message);
    }
  };

  const handleStart = async () => {
    setError(null);
    if (!modelName.trim()) return setError("Model name is required");
    if (!datasetName.trim()) return setError("Dataset name is required");
    setSubmitting(true);
    try {
      const body = {
        connectionId,
        model_name: modelName.trim(),
        base_model: baseModel,
        datasets: [{ name: datasetName.trim() }],
        training_type: trainingType,
        nr_epochs: Number(nrEpochs) || 3,
        learning_rate: Number(learningRate) || 0.0001,
      };
      const res = await fetch("/api/oauth/pioneer/training-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Start failed");
      // Reset form, switch to list, refresh
      setModelName("");
      setDatasetName("");
      setTab("list");
      await fetchJobs();
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} title={`Pioneer Fine-Tuning — ${connectionName || ""}`} onClose={onClose} size="xl">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2 border-b border-border pb-2">
          <button
            type="button"
            onClick={() => setTab("list")}
            className={`px-3 py-1.5 text-sm rounded-md ${tab === "list" ? "bg-primary text-white" : "hover:bg-sidebar"}`}
          >
            Jobs
          </button>
          <button
            type="button"
            onClick={() => setTab("new")}
            className={`px-3 py-1.5 text-sm rounded-md ${tab === "new" ? "bg-primary text-white" : "hover:bg-sidebar"}`}
          >
            New Job
          </button>
          <span className="ml-auto text-xs text-text-muted">
            Completed jobs become callable models on this connection.
          </span>
        </div>

        {tab === "list" && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Button onClick={fetchJobs} loading={loading} disabled={loading} icon="refresh" variant="secondary">
                Refresh
              </Button>
              <p className="text-xs text-text-muted">
                Showing {jobs.length} job{jobs.length === 1 ? "" : "s"}.
              </p>
            </div>
            {jobs.length === 0 && !loading && (
              <div className="text-sm text-text-muted text-center py-8">
                No training jobs yet. Click <span className="font-semibold">New Job</span> to fine-tune a base model.
              </div>
            )}
            {jobs.length > 0 && (
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-bg">
                    <tr>
                      <th className="px-3 py-2 text-left">Job ID</th>
                      <th className="px-3 py-2 text-left">Model Name</th>
                      <th className="px-3 py-2 text-left">Base</th>
                      <th className="px-3 py-2 text-left">Status</th>
                      <th className="px-3 py-2 text-left">Created</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.map((j) => {
                      const id = j.id || j.job_id;
                      const st = String(j.status || "").toLowerCase();
                      const isStoppable = st === "running" || st === "requested" || st === "queued";
                      return (
                        <tr key={id} className="border-t border-border">
                          <td className="px-3 py-2 font-mono text-xs">{id}</td>
                          <td className="px-3 py-2">{j.model_name || j.name || "—"}</td>
                          <td className="px-3 py-2 text-xs">{j.base_model || "—"}</td>
                          <td className={`px-3 py-2 font-medium ${statusClass(j.status)}`}>{j.status || "—"}</td>
                          <td className="px-3 py-2 text-xs text-text-muted">
                            {j.created_at ? new Date(j.created_at).toLocaleString() : "—"}
                          </td>
                          <td className="px-3 py-2">
                            {isStoppable && (
                              <button
                                type="button"
                                onClick={() => handleStop(id)}
                                className="text-xs text-red-500 hover:underline"
                              >
                                Stop
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {tab === "new" && (
          <div className="space-y-3">
            <div className="text-xs text-text-muted bg-bg border border-border rounded-md p-3 space-y-1">
              <p className="font-medium text-text">Fine-tuning fundamentals:</p>
              <ul className="list-disc list-inside space-y-1">
                <li>Pioneer only supports training on 5 open base models (Llama / Qwen / Gemma / SmolLM).</li>
                <li>Claude / GPT / Gemini are NOT trainable on Pioneer (closed weights).</li>
                <li>Dataset must already exist on Pioneer (upload via agent.pioneer.ai → Datasets).</li>
                <li>After job completes, the resulting model id is callable directly via /v1/chat/completions.</li>
              </ul>
            </div>

            <Input
              label="Model name"
              placeholder="e.g. my-router-llama-v1"
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              required
            />
            <Select
              label="Base model"
              value={baseModel}
              onChange={(e) => setBaseModel(e.target.value)}
              options={TRAINABLE_BASE_MODELS.map((m) => ({ value: m.id, label: m.label }))}
              required
            />
            <Input
              label="Dataset name"
              placeholder="Name of an existing Pioneer dataset"
              value={datasetName}
              onChange={(e) => setDatasetName(e.target.value)}
              required
            />
            <div className="grid grid-cols-3 gap-3">
              <Select
                label="Training type"
                value={trainingType}
                onChange={(e) => setTrainingType(e.target.value)}
                options={[
                  { value: "lora", label: "LoRA (recommended)" },
                  { value: "full", label: "Full fine-tune" },
                ]}
              />
              <Input
                label="Epochs"
                type="number"
                min={1}
                max={20}
                value={nrEpochs}
                onChange={(e) => setNrEpochs(e.target.value)}
              />
              <Input
                label="Learning rate"
                type="number"
                step={0.00001}
                value={learningRate}
                onChange={(e) => setLearningRate(e.target.value)}
              />
            </div>
            <Button onClick={handleStart} loading={submitting} disabled={submitting} icon="play_arrow">
              Start Training Job
            </Button>
          </div>
        )}

        {error && (
          <div className="p-3 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-600 dark:text-red-400">
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}

PioneerTrainingJobsModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  connectionId: PropTypes.string,
  connectionName: PropTypes.string,
};
