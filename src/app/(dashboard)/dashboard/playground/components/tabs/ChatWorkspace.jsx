import React, { useState, useEffect, useCallback } from "react";
import { buildPlaygroundRequest } from "../../lib/requestBuilder";
import { createSseParser } from "../../lib/sseParser";
import { createMetricAccumulator } from "../../lib/metrics.js";
import { sanitizePlaygroundData } from "../../lib/sanitize";

export default function ChatWorkspace({ configState, onMetricsUpdate, onResult, draft, onDraftChange }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState(draft || "");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState(null);
  const abortControllerRef = React.useRef(null);
  const abortMetricsRef = React.useRef(null);
  const outputRef = React.useRef("");

  useEffect(() => { setInput(draft || ""); }, [draft]);
  useEffect(() => () => abortControllerRef.current?.abort(), []);

  const reportError = useCallback((message) => setError(sanitizePlaygroundData(message)), []);

  const handleStop = useCallback(() => {
    const controller = abortControllerRef.current;
    if (!controller) return;
    controller.abort();
    const accumulator = abortMetricsRef.current;
    if (accumulator) {
      accumulator.abort(Date.now());
      const snapshot = accumulator.snapshot();
      if (onMetricsUpdate && snapshot.terminalState !== null) onMetricsUpdate(snapshot);
    }
    abortControllerRef.current = null;
    abortMetricsRef.current = null;
    setIsStreaming(false);
  }, [onMetricsUpdate]);

  const appendAssistantText = useCallback((text) => {
    outputRef.current += text;
    setMessages((previous) => {
      const lastIndex = previous.length - 1;
      const lastMessage = previous[lastIndex];
      if (!lastMessage || lastMessage.role !== "assistant") return previous;
      return [...previous.slice(0, lastIndex), { ...lastMessage, content: lastMessage.content + text }];
    });
  }, []);

  const finishAssistant = useCallback((partial) => {
    setMessages((previous) => {
      const lastIndex = previous.length - 1;
      const lastMessage = previous[lastIndex];
      if (!lastMessage || lastMessage.role !== "assistant") return previous;
      return [...previous.slice(0, lastIndex), { ...lastMessage, partial }];
    });
  }, []);

  const sendMessage = useCallback(async (forcedMessages = null) => {
    if (isStreaming) return;
    if (!configState?.model?.id) return reportError("A selected model is required.");
    const hasContent = input.trim().length > 0;
    const currentMessages = forcedMessages || (hasContent
      ? [...messages, { role: "user", content: input, partial: false }]
      : null);
    if (!currentMessages) return;

    let requestBody = null;
    let responseStatus = null;
    const controller = new AbortController();
    const accumulator = createMetricAccumulator(Date.now());
    const isCurrent = () => abortControllerRef.current === controller;
    abortControllerRef.current = controller;
    abortMetricsRef.current = accumulator;
    setError(null);
    setIsStreaming(true);
    outputRef.current = "";

    try {
      requestBody = buildPlaygroundRequest({
        model: configState.model,
        systemPrompt: configState.systemPrompt,
        messages: currentMessages,
        controls: configState.params,
      });
      if (!forcedMessages) {
        setMessages(currentMessages);
        setInput("");
        onDraftChange?.("");
      }
      const response = await fetch("/api/dashboard/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
      if (!isCurrent()) return;
      responseStatus = response.status ?? null;
      if (!response.ok) throw new Error(`HTTP error ${response.status}`);

      const parser = createSseParser();
      const reader = response.body.getReader();
      setMessages((previous) => [...previous, { role: "assistant", content: "", partial: true }]);
      while (true) {
        const { done, value } = await reader.read();
        if (!isCurrent()) { reader.cancel().catch(() => {}); return; }
        if (done) {
          const closeEvent = parser.close();
          if (closeEvent) accumulator.record(closeEvent, Date.now());
          break;
        }
        for (const event of parser.push(value)) {
          accumulator.record(event, Date.now());
          if (!isCurrent()) { reader.cancel().catch(() => {}); return; }
          if (event.type === "delta" && event.text) appendAssistantText(event.text);
          if (event.type === "malformed") {
            accumulator.record({ type: "error", message: "Malformed stream frame received" }, Date.now());
            reader.cancel().catch(() => {});
            throw new Error("Malformed stream frame received");
          }
          if (event.type === "error") { reader.cancel().catch(() => {}); throw new Error(event.message); }
          const snapshot = accumulator.snapshot();
          if (snapshot.terminalState) {
            reader.cancel().catch(() => {});
            if (snapshot.terminalState === "complete") finishAssistant(false);
            if (snapshot.terminalState === "incomplete") reportError("Stream ended unexpectedly.");
            return;
          }
        }
      }
      const snapshot = accumulator.snapshot();
      if (snapshot.terminalState === "incomplete") reportError("Stream ended unexpectedly.");
      if (snapshot.terminalState === "complete") finishAssistant(false);
    } catch (caughtError) {
      if (!isCurrent()) return;
      if (caughtError.name === "AbortError") accumulator.abort(Date.now());
      else {
        accumulator.record({ type: "error", message: caughtError.message }, Date.now());
        reportError(caughtError.message);
      }
    } finally {
      if (!isCurrent()) return;
      abortControllerRef.current = null;
      abortMetricsRef.current = null;
      setIsStreaming(false);
      const snapshot = accumulator.snapshot();
      if (onMetricsUpdate && snapshot.terminalState !== null) onMetricsUpdate(snapshot);
      if (onResult && requestBody) onResult(sanitizePlaygroundData({
        request: requestBody,
        response: { status: responseStatus, output: outputRef.current },
        metrics: snapshot,
      }));
    }
  }, [appendAssistantText, configState, finishAssistant, input, isStreaming, messages, onDraftChange, onMetricsUpdate, onResult, reportError]);

  const handleRegenerate = useCallback(() => {
    if (messages.length === 0 || isStreaming) return;
    const nextMessages = messages.at(-1)?.role === "assistant" ? messages.slice(0, -1) : messages;
    setMessages(nextMessages);
    sendMessage(nextMessages);
  }, [isStreaming, messages, sendMessage]);

  const handleClear = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsStreaming(false);
    setMessages([]);
    setError(null);
  }, []);

  return (
    <div className="flex flex-col h-full relative" data-testid="playground-chat-workspace">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((message, index) => (
          <div key={index} className={`p-4 rounded-lg ${message.role === "user" ? "bg-primary/10 ml-8" : "bg-surface mr-8 border border-border"}`}>
            <div className="flex justify-between items-center mb-1"><div className="font-semibold text-sm text-text-muted">{message.role === "user" ? "User" : "Assistant"}</div>{message.partial && <span className="text-xs bg-warning/20 text-warning px-2 py-0.5 rounded" data-testid="partial-indicator">Partial</span>}</div>
            <pre className="whitespace-pre-wrap font-sans text-sm">{message.content}</pre>
          </div>
        ))}
        {error && <div className="p-4 bg-error/10 text-error rounded-lg text-sm border border-error/20" data-testid="chat-error">{error}</div>}
      </div>
      <div className="p-4 border-t border-border bg-bg-alt flex flex-col gap-2">
        <div className="flex gap-2 items-end">
          <textarea value={input} onChange={(event) => { setInput(event.target.value); onDraftChange?.(event.target.value); }} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendMessage(); } }} placeholder="Send a message..." className="flex-1 bg-surface border border-border rounded-lg p-3 text-sm focus:outline-none focus:border-primary resize-none min-h-[60px] max-h-[200px]" disabled={isStreaming} />
          <div className="flex flex-col gap-2 shrink-0">
            {isStreaming ? <button onClick={handleStop} className="bg-error hover:bg-error-hover text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors" data-testid="playground-stop">Stop</button> : <button onClick={() => sendMessage()} disabled={!input.trim()} className="bg-primary hover:bg-primary-hover disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors" data-testid="playground-send">Send</button>}
            {messages.length > 0 && !isStreaming && <button onClick={handleRegenerate} className="text-text-muted hover:text-text-main text-xs text-center" data-testid="playground-regenerate">Regenerate</button>}
            {messages.length > 0 && !isStreaming && <button onClick={handleClear} className="text-text-muted hover:text-text-main text-xs text-center" data-testid="playground-clear">Clear</button>}
          </div>
        </div>
      </div>
    </div>
  );
}
