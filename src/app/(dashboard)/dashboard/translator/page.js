"use client";

import { useState, useRef, useEffect } from "react";
import { Card, Button, Select } from "@/shared/components";
import dynamic from "next/dynamic";

// Dynamically import Monaco Editor (client-side only)
const Editor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

const PROVIDERS = [
  { value: "antigravity", label: "Antigravity" },
  { value: "gemini-cli", label: "Gemini CLI" },
  { value: "claude", label: "Claude" },
  { value: "codex", label: "Codex" },
  { value: "github", label: "GitHub" },
  { value: "qwen", label: "Qwen" },
  { value: "iflow", label: "iFlow AI" },
  { value: "kiro", label: "Kiro AI" },
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "gemini", label: "Gemini" },
  { value: "openrouter", label: "OpenRouter" },
  { value: "glm", label: "GLM" },
  { value: "kimi", label: "Kimi" },
  { value: "kimi-coding", label: "Kimi Coding" },
  { value: "minimax", label: "MiniMax" },
];

const STEPS = [
  { id: 1, name: "Client Request", file: "1_req_client.json" },
  { id: 2, name: "Source Format", file: "2_req_source.json" },
  { id: 3, name: "OpenAI Intermediate", file: "3_req_openai.json" },
  { id: 4, name: "Target Format", file: "4_req_target.json" },
  { id: 5, name: "Provider Response", file: "5_res_provider.txt" },
];

export default function TranslatorPage() {
  const [provider, setProvider] = useState("antigravity");
  const [steps, setSteps] = useState({
    1: "",
    2: "",
    3: "",
    4: "",
    5: "",
  });
  const [expanded, setExpanded] = useState({
    1: true,
    2: false,
    3: false,
    4: false,
    5: false,
  });
  const [loading, setLoading] = useState({});

  const toggleExpand = (stepId) => {
    setExpanded({ ...expanded, [stepId]: !expanded[stepId] });
  };

  const handleSendToProvider = async () => {
    setLoading({ ...loading, "send-provider": true });
    try {
      const step4Content = steps[4];
      if (!step4Content) {
        alert("Please load or generate step 4 content first");
        return;
      }

      const body = JSON.parse(step4Content);
      
      // Get credentials (you may need to prompt user or use stored credentials)
      const credentials = {
        accessToken: prompt("Enter access token (or leave empty):") || undefined,
        apiKey: prompt("Enter API key (or leave empty):") || undefined
      };

      const res = await fetch("/api/translator/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          body,
          credentials
        })
      });

      const data = await res.json();
      
      if (data.success) {
        // Update step 5 with provider response
        setSteps({ ...steps, 5: data.body });
        
        // Save step 5
        await fetch("/api/translator/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            file: "5_res_provider.txt",
            content: data.body
          })
        });
        
        // Expand step 5
        setExpanded({ ...expanded, 4: false, 5: true });
        
        alert(`Request sent! Status: ${data.status} ${data.statusText}`);
      } else {
        alert(data.error || "Failed to send request");
      }
    } catch (err) {
      alert("Error sending request: " + err.message);
    }
    setLoading({ ...loading, "send-provider": false });
  };

  const handleLoad = async (stepId) => {
    setLoading({ ...loading, [`load-${stepId}`]: true });
    try {
      const step = STEPS.find(s => s.id === stepId);
      const res = await fetch(`/api/translator/load?file=${step.file}`);
      const data = await res.json();
      if (data.success) {
        setSteps({ ...steps, [stepId]: data.content });
      } else {
        alert(data.error || "Failed to load file");
      }
    } catch (err) {
      alert("Error loading file: " + err.message);
    }
    setLoading({ ...loading, [`load-${stepId}`]: false });
  };

  const handleLean = (stepId) => {
    try {
      const content = steps[stepId];
      if (!content) return;
      
      const obj = JSON.parse(content);
      const leaned = leanJSON(obj);
      setSteps({ ...steps, [stepId]: JSON.stringify(leaned, null, 2) });
    } catch (err) {
      alert("Error parsing JSON: " + err.message);
    }
  };

  const handleFormat = (stepId) => {
    try {
      const content = steps[stepId];
      if (!content) return;
      
      const obj = JSON.parse(content);
      setSteps({ ...steps, [stepId]: JSON.stringify(obj, null, 2) });
    } catch (err) {
      alert("Error parsing JSON: " + err.message);
    }
  };

  const handleCopy = async (stepId) => {
    try {
      const content = steps[stepId];
      if (!content) return;
      
      await navigator.clipboard.writeText(content);
      alert("Copied to clipboard!");
    } catch (err) {
      alert("Error copying: " + err.message);
    }
  };

  const handleUpdate = async (stepId) => {
    setLoading({ ...loading, [`update-${stepId}`]: true });
    try {
      const step = STEPS.find(s => s.id === stepId);
      const res = await fetch("/api/translator/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file: step.file,
          content: steps[stepId]
        })
      });
      const data = await res.json();
      if (data.success) {
        alert("File saved successfully");
      } else {
        alert(data.error || "Failed to save file");
      }
    } catch (err) {
      alert("Error saving file: " + err.message);
    }
    setLoading({ ...loading, [`update-${stepId}`]: false });
  };

  const handleSubmit = async (stepId) => {
    setLoading({ ...loading, [`submit-${stepId}`]: true });
    try {
      // 1. Save current step
      const currentStep = STEPS.find(s => s.id === stepId);
      await fetch("/api/translator/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file: currentStep.file,
          content: steps[stepId]
        })
      });

      // Step 4: Send to provider instead of translate
      if (stepId === 4) {
        const res = await fetch("/api/translator/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider,
            body: JSON.parse(steps[4])
          })
        });
        
        if (!res.ok) {
          const errorData = await res.json();
          alert(errorData.error || "Failed to send request");
          setLoading({ ...loading, [`submit-${stepId}`]: false });
          return;
        }

        // Read streaming response
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let fullResponse = "";
        
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          const chunk = decoder.decode(value, { stream: true });
          fullResponse += chunk;
        }
        
        // Save to step 5
        setSteps({ ...steps, 5: fullResponse });
        
        await fetch("/api/translator/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            file: "5_res_provider.txt",
            content: fullResponse
          })
        });
        
        setExpanded({ ...expanded, [stepId]: false, 5: true });
        alert("Request sent to provider successfully!");
      } else {
        // Steps 1-3: Translate to next step
        const res = await fetch("/api/translator/translate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            step: stepId,
            provider,
            body: JSON.parse(steps[stepId])
          })
        });
        const data = await res.json();
        
        if (data.success) {
          const nextStepId = stepId + 1;
          const nextContent = JSON.stringify(data.result, null, 2);
          
          setSteps({ ...steps, [nextStepId]: nextContent });
          
          const nextStep = STEPS.find(s => s.id === nextStepId);
          await fetch("/api/translator/save", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              file: nextStep.file,
              content: nextContent
            })
          });
          
          setExpanded({ ...expanded, [stepId]: false, [nextStepId]: true });
        } else {
          alert(data.error || "Translation failed");
        }
      }
    } catch (err) {
      alert("Error: " + err.message);
    }
    setLoading({ ...loading, [`submit-${stepId}`]: false });
  };

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-main">Translator Debug</h1>
          <p className="text-sm text-text-muted mt-1">
            Debug translation flow between formats
          </p>
        </div>
      </div>

      {/* Provider Selector */}
      <Card>
        <div className="p-4 flex items-center gap-4">
          <div className="flex-1">
            <label className="block text-sm font-medium text-text-main mb-2">
              Provider
            </label>
            <Select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              options={PROVIDERS}
            />
          </div>
          
          <div className="pt-6">
            <Button
              icon="send"
              onClick={handleSendToProvider}
              loading={loading["send-provider"]}
            >
              Send to Provider
            </Button>
          </div>
        </div>
      </Card>

      {/* Steps */}
      {STEPS.map((step) => (
        <Card key={step.id}>
          <div className="p-4 space-y-3">
            {/* Header with expand/collapse */}
            <div className="flex items-center justify-between">
              <button
                onClick={() => toggleExpand(step.id)}
                className="flex items-center gap-2 flex-1 text-left group"
              >
                <span className="material-symbols-outlined text-[20px] text-text-muted group-hover:text-primary transition-colors">
                  {expanded[step.id] ? "expand_more" : "chevron_right"}
                </span>
                <h3 className="text-sm font-semibold text-text-main">
                  {step.id}. {step.name}
                </h3>
                <span className="text-xs text-text-muted ml-2">{step.file}</span>
                {steps[step.id] && (
                  <span className="text-xs text-green-500 ml-2">
                    ({steps[step.id].length} chars)
                  </span>
                )}
              </button>

              {/* Quick actions when collapsed */}
              {!expanded[step.id] && (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="folder_open"
                    onClick={() => handleLoad(step.id)}
                    loading={loading[`load-${step.id}`]}
                  />
                  {step.id <= 4 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon="arrow_forward"
                      onClick={() => handleSubmit(step.id)}
                      loading={loading[`submit-${step.id}`]}
                    />
                  )}
                </div>
              )}
            </div>

            {/* Expandable content */}
            {expanded[step.id] && (
              <>
                <div className="relative border border-border rounded-lg overflow-hidden">
                  <Editor
                    height="400px"
                    defaultLanguage="json"
                    value={steps[step.id]}
                    onChange={(value) => setSteps({ ...steps, [step.id]: value || "" })}
                    theme="vs-dark"
                    options={{
                      minimap: { enabled: false },
                      fontSize: 12,
                      lineNumbers: "on",
                      scrollBeyondLastLine: false,
                      wordWrap: "on",
                      automaticLayout: true,
                      formatOnPaste: true,
                      formatOnType: true,
                    }}
                  />
                </div>

                <div className="flex gap-2 flex-wrap">
                  <Button
                    size="sm"
                    variant="outline"
                    icon="folder_open"
                    onClick={() => handleLoad(step.id)}
                    loading={loading[`load-${step.id}`]}
                  >
                    Load
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    icon="compress"
                    onClick={() => handleLean(step.id)}
                  >
                    Lean
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    icon="content_copy"
                    onClick={() => handleCopy(step.id)}
                  >
                    Copy
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    icon="save"
                    onClick={() => handleUpdate(step.id)}
                    loading={loading[`update-${step.id}`]}
                  >
                    Update
                  </Button>
                  {step.id <= 4 && (
                    <Button
                      size="sm"
                      icon="arrow_forward"
                      onClick={() => handleSubmit(step.id)}
                      loading={loading[`submit-${step.id}`]}
                    >
                      {step.id === 4 ? "Send to Provider" : "Submit"}
                    </Button>
                  )}
                </div>
              </>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}

// Lean function: truncate long text
function leanJSON(obj, maxTextLen = 2222) {
  const result = JSON.parse(JSON.stringify(obj)); // Deep clone

  // Recursive function to truncate all strings
  function truncateDeep(item) {
    if (typeof item === "string") {
      return item.length > maxTextLen ? item.slice(0, maxTextLen) + "..." : item;
    }
    
    if (Array.isArray(item)) {
      return item.map(truncateDeep);
    }
    
    if (item && typeof item === "object") {
      const truncated = {};
      for (const key in item) {
        truncated[key] = truncateDeep(item[key]);
      }
      return truncated;
    }
    
    return item;
  }

  return truncateDeep(result);
}

function truncateContent(content, maxLen) {
  if (typeof content === "string") {
    return truncateText(content, maxLen);
  }
  if (Array.isArray(content)) {
    return content.map(part => {
      if (part.type === "text" && part.text) {
        return { ...part, text: truncateText(part.text, maxLen) };
      }
      return part;
    });
  }
  return content;
}

function truncateText(text, maxLen) {
  if (!text || text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "...";
}
