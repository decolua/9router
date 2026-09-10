"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Card, CardSkeleton, Select } from "@/shared/components";
import { CHAT_COMPLETION_ENDPOINTS, createRequestTemplate, getEndpointConfig, stringifyBody } from "./requestTemplates";

function updateModelInBody(rawBody, nextModel, endpointId) {
  try {
    const parsed = JSON.parse(rawBody);
    if (!nextModel) {
      delete parsed.model;
    } else {
      parsed.model = nextModel;
    }
    return stringifyBody(parsed);
  } catch {
    return stringifyBody(createRequestTemplate(endpointId, nextModel));
  }
}

function parseResponseBody(responseText) {
  try {
    return stringifyBody(JSON.parse(responseText));
  } catch {
    return responseText;
  }
}

export default function ChatCompletionsPageClient() {
  const [combos, setCombos] = useState([]);
  const [keys, setKeys] = useState([]);
  const [selectedCombo, setSelectedCombo] = useState("");
  const [selectedApi, setSelectedApi] = useState("chat-completions");
  const [selectedApiKey, setSelectedApiKey] = useState("");
  const [requestBody, setRequestBody] = useState(stringifyBody(createRequestTemplate("chat-completions", "")));
  const [responseBody, setResponseBody] = useState("");
  const [responseStatus, setResponseStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      setLoading(true);
      setError("");

      try {
        const [combosRes, keysRes] = await Promise.all([
          fetch("/api/combos", { cache: "no-store" }),
          fetch("/api/keys", { cache: "no-store" }),
        ]);

        const [combosData, keysData] = await Promise.all([
          combosRes.json().catch(() => ({})),
          keysRes.json().catch(() => ({})),
        ]);

        if (cancelled) return;

        const nextCombos = Array.isArray(combosData.combos) ? combosData.combos : [];
        const nextKeys = Array.isArray(keysData.keys) ? keysData.keys.filter((key) => key?.isActive !== false) : [];

        setCombos(nextCombos);
        setKeys(nextKeys);

        const firstCombo = nextCombos[0]?.name || "";
        const firstKey = nextKeys[0]?.key || "";

        setSelectedCombo((current) => current || firstCombo);
          setSelectedApiKey((current) => current || firstKey);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError?.message || "Failed to load combos or keys.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadData();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setRequestBody((current) => updateModelInBody(current, selectedCombo, selectedApi));
  }, [selectedCombo, selectedApi]);

  const comboOptions = useMemo(
    () => combos.map((combo) => ({ value: combo.name, label: combo.name })),
    [combos]
  );

  const keyOptions = useMemo(
    () => keys.map((key) => ({
      value: key.key,
      label: `${key.name} · ${key.key.slice(0, 12)}...`,
    })),
    [keys]
  );

  const apiOptions = useMemo(
    () => CHAT_COMPLETION_ENDPOINTS.map((api) => ({ value: api.id, label: api.label })),
    []
  );

  const selectedApiConfig = useMemo(() => getEndpointConfig(selectedApi), [selectedApi]);
  const isBodyEditable = selectedApiConfig.method === "POST";

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    setResponseBody("");
    setResponseStatus(null);

    try {
      const parsedBody = isBodyEditable ? JSON.parse(requestBody) : null;

      const response = await fetch("/api/chat-completions/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          endpointId: selectedApi,
          apiKey: selectedApiKey,
          body: parsedBody,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || "Request failed");
      }

      setResponseStatus({
        ok: data.ok,
        status: data.status,
        statusText: data.statusText,
        contentType: data.contentType || "",
      });
      setResponseBody(parseResponseBody(data.body || ""));
    } catch (submitError) {
      setError(submitError?.message || "Request failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  const hasCombos = comboOptions.length > 0;
  const hasKeys = keyOptions.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <Card
        title="Chat Completions"
        subtitle="Test 9Router endpoints directly with the first saved API key and editable request bodies."
        icon="chat"
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Select
            label="API Endpoint"
            value={selectedApi}
            onChange={(event) => {
              const nextApi = event.target.value;
              setSelectedApi(nextApi);
              setRequestBody(stringifyBody(createRequestTemplate(nextApi, selectedCombo)));
            }}
            options={apiOptions}
          />
          <Select
            label="Model Combo"
            value={selectedCombo}
            onChange={(event) => setSelectedCombo(event.target.value)}
            options={comboOptions}
            placeholder={hasCombos ? "Select a combo" : "No combos available"}
            disabled={!hasCombos}
            hint={!hasCombos ? "Create a combo first in the Combos tab." : undefined}
          />
        </div>
        {!hasKeys && (
          <p className="mt-4 text-sm text-text-muted">
            Create an endpoint API key first in the Endpoint tab.
          </p>
        )}
      </Card>

      <form className="grid gap-6 xl:grid-cols-2" onSubmit={handleSubmit}>
        <Card
          title="Request Body"
          subtitle={isBodyEditable ? "Edit the raw JSON before sending." : "This endpoint uses GET, so no request body is sent."}
          icon="data_object"
          action={(
            <Button
              type="submit"
              icon="send"
              loading={submitting}
              disabled={!selectedApiKey}
            >
              Submit
            </Button>
          )}
        >
          <textarea
            value={requestBody}
            onChange={(event) => setRequestBody(event.target.value)}
            spellCheck={false}
            disabled={!isBodyEditable}
            className="min-h-[420px] w-full rounded-lg border border-black/10 bg-white px-4 py-3 font-mono text-sm text-text-main shadow-inner outline-none transition-all focus:border-primary/50 focus:ring-1 focus:ring-primary/30 dark:border-white/10 dark:bg-white/5"
          />
          {error && (
            <div className="mt-3 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
              {error}
            </div>
          )}
        </Card>

        <Card
          title="Response"
          subtitle="Raw response body from the selected endpoint."
          icon="article"
        >
          {responseStatus && (
            <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
              <span className={`rounded-full px-2 py-1 font-medium ${responseStatus.ok ? "bg-green-500/10 text-green-600 dark:text-green-400" : "bg-red-500/10 text-red-600 dark:text-red-400"}`}>
                {responseStatus.status} {responseStatus.statusText}
              </span>
              {responseStatus.contentType ? (
                <span className="rounded-full bg-black/5 px-2 py-1 text-text-muted dark:bg-white/5">
                  {responseStatus.contentType}
                </span>
              ) : null}
            </div>
          )}
          <textarea
            value={responseBody}
            readOnly
            spellCheck={false}
            placeholder="Response will appear here after submit."
            className="min-h-[420px] w-full rounded-lg border border-black/10 bg-black/[0.02] px-4 py-3 font-mono text-sm text-text-main shadow-inner outline-none dark:border-white/10 dark:bg-white/[0.03]"
          />
        </Card>
      </form>
    </div>
  );
}
