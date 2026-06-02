"use client";

import { useState, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import Modal from "@/shared/components/Modal";
import Button from "@/shared/components/Button";
import Toggle from "@/shared/components/Toggle";
import Badge from "@/shared/components/Badge";
import Card from "@/shared/components/Card";
import { PROVIDERS } from "open-sse/config/providers.js";
import { USAGE_SUPPORTED_PROVIDERS } from "@/shared/constants/providers";

const Editor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

const DEFAULT_SCRIPT = `({
  request: {
    url: (ctx) => \`\${ctx.baseUrl}/v1/usage\`,
    method: "GET",
    headers: {
      "x-api-key": (ctx) => ctx.apiKey,
      "Accept": "application/json"
    }
  },
  extractor: function(response, ctx) {
    // ctx: { baseUrl, apiKey, accessToken, providerSpecificData, connection }
    // response: parsed JSON from the API call
    // Return remaining as percentage (0-100), not raw credit value
    const rawRemaining = response.remaining || 0;
    const total = response.total || 0;
    const remaining = total > 0 ? Math.round((rawRemaining / total) * 100) : 0;
    return {
      isValid: true,
      remaining,
      total,
      used: response.used || 0,
      unit: response.unit || "USD"
    };
  }
})`;

export default function CustomUsageModal({ isOpen, providerNode, connection, onSave, onClose }) {
  const [enabled, setEnabled] = useState(false);
  const [script, setScript] = useState(DEFAULT_SCRIPT);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [testError, setTestError] = useState(null);
  const [saving, setSaving] = useState(false);
  const editorRef = useRef(null);

  useEffect(() => {
    if (providerNode) {
      const config = providerNode.customUsageConfig;
      if (config?.enabled && config?.script) {
        setEnabled(true);
        setScript(config.script);
      } else {
        setEnabled(false);
        setScript(DEFAULT_SCRIPT);
      }
      setTestResult(null);
      setTestError(null);
    }
  }, [providerNode, isOpen]);

  const handleEditorDidMount = (editor, monaco) => {
    editorRef.current = editor;
    monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
      validate: true,
      schemas: [{
        uri: "http://example.com/usage-schema.json",
        fileMatch: ["*"],
        schema: {
          type: "object",
          required: ["request", "extractor"],
          properties: {
            request: {
              type: "object",
              required: ["url"],
              properties: {
                url: { type: ["string", "function"] },
                method: { type: "string" },
                headers: { type: ["object", "function"] }
              }
            },
            extractor: { type: "function" }
          }
        }
      }]
    });
  };

  const handleTest = async () => {
    // Test using providerNode (node-level config shared by all connections under it)
    // Use first connection under this node for testing
    if (!providerNode && !connection?.id) return;

    setTesting(true);
    setTestError(null);
    setTestResult(null);

    try {
      // Use connection.id if available (for backward compatibility), otherwise use providerNodeId
      const testConnectionId = connection?.id;

      const res = await fetch("/api/usage/test-custom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectionId: testConnectionId,
          providerNodeId: providerNode?.id,
          script: script
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setTestError(data.error || "Test failed");
        setTestResult(null);
      } else if (data.isValid === false) {
        setTestError(data.invalidMessage || "Invalid result");
        setTestResult(null);
      } else {
        setTestResult(data);
        setTestError(null);
      }
    } catch (e) {
      setTestError(`Network error: ${e.message}`);
      setTestResult(null);
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!providerNode && !connection?.id) return;

    let parsedScript;
    try {
      parsedScript = new Function(`return ${script}`)();
    } catch (e) {
      setTestError(`Script parse error: ${e.message}`);
      return;
    }

    if (!parsedScript.request?.url || !parsedScript.extractor) {
      setTestError("Script must have 'request' (with url) and 'extractor' function");
      return;
    }

    setSaving(true);
    try {
      await onSave({
        customUsageConfig: enabled ? { enabled: true, script } : null
      });
      onClose();
    } catch (e) {
      setTestError(`Save failed: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  if (!providerNode && !connection) return null;

  const provider = connection?.provider;
  const providerConfig = provider ? PROVIDERS[provider] : null;
  const hasBuiltInUsage = provider && USAGE_SUPPORTED_PROVIDERS.includes(provider);

  return (
    <Modal isOpen={isOpen} title="Custom Usage Fetcher" onClose={onClose} size="lg">
      <div className="flex flex-col gap-4 max-h-[80vh] overflow-hidden">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Toggle
              checked={enabled}
              onChange={setEnabled}
              size="sm"
            />
            <span className="text-sm font-medium">Enable Custom Usage Fetcher</span>
          </div>
          {hasBuiltInUsage && (
            <Badge variant="warning" size="sm">
              Provider has built-in usage
            </Badge>
          )}
        </div>

        {enabled && (
          <>
            <div className="text-xs text-text-muted">
              <p className="mb-2">
                Define a script to fetch usage data for <code className="px-1 py-0.5 rounded bg-black/5 dark:bg-white/5">{provider || "provider"}</code>.
                Available context (ctx) variables:
              </p>
              <ul className="list-disc list-inside space-y-0.5">
                <li><code>ctx.baseUrl</code> — Provider API base URL</li>
                <li><code>ctx.apiKey</code> — API key (if available)</li>
                <li><code>ctx.accessToken</code> — OAuth access token (if available)</li>
                <li><code>ctx.providerSpecificData</code> — Provider-specific data</li>
                <li><code>ctx.connection</code> — Full connection object</li>
              </ul>
            </div>

            <div className="rounded-lg border border-border overflow-hidden" style={{ height: "320px" }}>
              <Editor
                height="100%"
                language="javascript"
                value={script}
                onChange={(value) => setScript(value || "")}
                onMount={handleEditorDidMount}
                options={{
                  minimap: { enabled: false },
                  fontSize: 12,
                  lineNumbers: "on",
                  scrollBeyondLastLine: false,
                  wordWrap: "on",
                  automaticLayout: true,
                  tabSize: 2,
                }}
                theme="vs-light"
              />
            </div>

            {testResult && (
              <Card padding="sm" className="bg-success/10 border-success/20">
                <div className="text-xs font-medium text-success mb-1">Test Result</div>
                <pre className="text-xs overflow-auto max-h-32 text-success">
                  {JSON.stringify(testResult, null, 2)}
                </pre>
              </Card>
            )}

            {testError && (
              <Card padding="sm" className="bg-error/10 border-error/20">
                <div className="text-xs font-medium text-error mb-1">Error</div>
                <p className="text-xs text-error">{testError}</p>
              </Card>
            )}

            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={handleTest}
                disabled={testing || saving}
              >
                {testing ? "Testing..." : "Test Script"}
              </Button>
              <Button
                onClick={handleSave}
                disabled={testing || saving}
              >
                {saving ? "Saving..." : "Save"}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
