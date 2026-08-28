import React, { useState, useRef, useEffect, useCallback } from "react";
import { buildPlaygroundRequest } from "../../lib/requestBuilder";
import { createSseParser } from "../../lib/sseParser";
import { createMetricAccumulator } from "../../lib/metrics";
import { sanitizePlaygroundData } from "../../lib/sanitize";

const DEFAULT_COLUMN_IDS = ["col-default-a", "col-default-b"]; // fixed, deterministic, no randomness at initial render

function generateColumnId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // fallback for environments without crypto.randomUUID — monotonic, collision-safe within this session
  generateColumnId._counter = (generateColumnId._counter || 0) + 1;
  return `col-fallback-${generateColumnId._counter}`;
}

export default function CompareWorkspace({ configState, availableModels = [], onResult, draft, onDraftChange }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState(draft || "");
  const [columns, setColumns] = useState([
    { id: DEFAULT_COLUMN_IDS[0], model: null, output: "", state: "idle", metrics: null, error: null },
    { id: DEFAULT_COLUMN_IDS[1], model: null, output: "", state: "idle", metrics: null, error: null }
  ]);
  
  const abortControllersRef = useRef({});
  const rafRefs = useRef({});
  const outputBuffersRef = useRef({});
  const terminalOutputsRef = useRef({});

  useEffect(() => {
    setInput(draft || "");
  }, [draft]);

  const cleanupColumn = useCallback((colId, terminalState = null) => {
    const bufferedOutput = outputBuffersRef.current[colId];
    if (terminalState) {
      terminalOutputsRef.current[colId] = bufferedOutput ?? "";
      setColumns(prev => prev.map(col =>
        col.id === colId
          ? { ...col, output: bufferedOutput ?? col.output, state: terminalState }
          : col
      ));
    }
    if (abortControllersRef.current[colId]) {
      abortControllersRef.current[colId].abort();
      delete abortControllersRef.current[colId];
    }
    if (rafRefs.current[colId]) {
      cancelAnimationFrame(rafRefs.current[colId]);
      delete rafRefs.current[colId];
    }
    delete outputBuffersRef.current[colId];
  }, []);

  useEffect(() => {
    return () => {
      Object.keys(abortControllersRef.current).forEach(colId => cleanupColumn(colId));
    };
  }, [cleanupColumn]);

  const setColumnModel = (colId, modelInfo) => {
    setColumns(prev => prev.map(col => 
      col.id === colId ? { ...col, model: modelInfo } : col
    ));
  };

  const addColumn = () => {
    if (columns.length >= 4) return;
    setColumns(prev => [...prev, { 
      id: generateColumnId(), 
      model: null, 
      output: "", 
      state: "idle", 
      metrics: null, 
      error: null 
    }]);
  };

  const removeColumn = (colId) => {
    cleanupColumn(colId);
    setColumns(prev => prev.filter(col => col.id !== colId));
  };

  const updateColumnState = (colId, updates) => {
    setColumns(prev => prev.map(col => 
      col.id === colId ? { ...col, ...updates } : col
    ));
  };

  const handleStopAll = useCallback(() => {
    columns.forEach(col => {
      if (col.state === "waiting" || col.state === "streaming") {
        cleanupColumn(col.id, "aborted");
      }
    });
  }, [columns, cleanupColumn]);

  const handleStopColumn = useCallback((colId) => {
    cleanupColumn(colId, "aborted");
  }, [cleanupColumn]);

  const sendMessage = useCallback(async (forcedMessages = null) => {
    const activeColumns = columns.filter(col => col.model);
    if (activeColumns.length === 0) return;
    
    const isAnyStreaming = columns.some(c => c.state === "waiting" || c.state === "streaming");
    if (isAnyStreaming) return;
    
    let currentMessages = forcedMessages;
    if (!currentMessages) {
       if (!input.trim()) return;
       const newMsg = { role: "user", content: input };
       currentMessages = [...messages, newMsg];
       setMessages(currentMessages);
                setInput("");
                onDraftChange?.("");
    }
    
    activeColumns.forEach(col => {
      updateColumnState(col.id, { 
        output: "", 
        state: "waiting", 
        metrics: null, 
        error: null 
      });
      
      const abortController = new AbortController();
      abortControllersRef.current[col.id] = abortController;
      outputBuffersRef.current[col.id] = "";
      
      const accumulator = createMetricAccumulator(Date.now());
      
      // Fire and forget per column
      (async () => {
        let requestBody = null;
        let responseStatus = null;
        let resultPublished = false;
        const publishResult = () => {
          if (resultPublished || !requestBody) return;
          resultPublished = true;
          onResult?.(sanitizePlaygroundData({
            request: requestBody,
            response: { status: responseStatus, output: outputBuffersRef.current[col.id] ?? terminalOutputsRef.current[col.id] ?? "" },
            metrics: accumulator.snapshot(),
          }));
        };
        try {
          requestBody = {
            ...buildPlaygroundRequest({
              model: col.model,
              systemPrompt: configState.systemPrompt,
              messages: currentMessages,
              controls: configState.params,
              images: []
            }),
            model: col.model.id,
          };
          
          const response = await fetch("/api/dashboard/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requestBody),
            signal: abortController.signal
          });
          
          responseStatus = response.status ?? null;
          if (!response.ok) {
             throw new Error(`HTTP error ${response.status}`);
          }
          
          if (abortController.signal.aborted) {
               accumulator.abort(Date.now());
               updateColumnState(col.id, { state: "aborted", metrics: accumulator.snapshot() });
               publishResult();
               return;
          }

          updateColumnState(col.id, { state: "streaming" });
          
          const parser = createSseParser();
          const reader = response.body.getReader();
          
          const scheduleUpdate = () => {
            if (!rafRefs.current[col.id]) {
              rafRefs.current[col.id] = requestAnimationFrame(() => {
                rafRefs.current[col.id] = null;
                updateColumnState(col.id, { output: outputBuffersRef.current[col.id] });
              });
            }
          };

          while (true) {
            const { done, value } = await reader.read();
             if (abortController.signal.aborted) {
               accumulator.abort(Date.now());
               publishResult();
               return;
             }
            
            let events = [];
            if (value) {
                events = parser.push(value);
            }
            if (done) {
                const trailingEvent = parser.close();
                if (trailingEvent) events.push(trailingEvent);
            }
            
            let isTerminal = false;
            for (const event of events) {
               accumulator.record(event, Date.now());
               
               if (event.type === "done" || event.type === "error" || event.type === "incomplete") {
                   isTerminal = true;
               }

               if (event.type === "delta" && event.text) {
                   outputBuffersRef.current[col.id] += event.text;
                   scheduleUpdate();
               } else if (event.type === "error") {
                   throw new Error(event.message);
               } else if (event.type === "incomplete" && !abortController.signal.aborted) {
                   reader.cancel().catch(() => {});
                    updateColumnState(col.id, {
                      state: "incomplete",
                      metrics: accumulator.snapshot(),
                      output: outputBuffersRef.current[col.id],
                    });
                    publishResult();
                    return;
               }
            }
            
            if (done || isTerminal) {
               reader.cancel().catch(() => {});
               break;
            }
          }
          
           if (abortController.signal.aborted) {
              accumulator.abort(Date.now());
              updateColumnState(col.id, { state: "aborted", metrics: accumulator.snapshot() });
              publishResult();
           } else {
             // Force final flush
             if (rafRefs.current[col.id]) {
                cancelAnimationFrame(rafRefs.current[col.id]);
                rafRefs.current[col.id] = null;
             }
             const metrics = accumulator.snapshot();
             const output = outputBuffersRef.current[col.id];
             updateColumnState(col.id, { 
                state: metrics.terminalState || "complete", 
                output,
                metrics
             });
              publishResult();
          }

        } catch (err) {
           if (err.name === "AbortError") {
              accumulator.abort(Date.now());
              updateColumnState(col.id, { state: "aborted", metrics: accumulator.snapshot() });
              publishResult();
           } else {
              accumulator.record({ type: "error", message: err.message }, Date.now());
              updateColumnState(col.id, { 
                state: "error", 
                error: sanitizePlaygroundData(err.message),
                metrics: accumulator.snapshot()
              });
              publishResult();
           }
        } finally {
          delete abortControllersRef.current[col.id];
          if (rafRefs.current[col.id]) {
             cancelAnimationFrame(rafRefs.current[col.id]);
             delete rafRefs.current[col.id];
          }
        }
      })();
    });
  }, [input, messages, columns, configState, cleanupColumn]);

  const handleClear = useCallback(() => {
    setMessages([]);
    columns.forEach(col => {
       cleanupColumn(col.id);
       updateColumnState(col.id, { output: "", state: "idle", metrics: null, error: null });
    });
  }, [columns, cleanupColumn]);

  const isAnyStreaming = columns.some(c => c.state === "waiting" || c.state === "streaming");

  return (
    <div className="flex flex-col h-full relative" data-testid="playground-compare-workspace">
      
      {/* Messages area - shared prompt history */}
      <div className="flex-none p-4 max-h-[30%] overflow-y-auto border-b border-border">
         {messages.length === 0 ? (
             <div className="text-text-muted text-sm italic">No messages yet. Send a prompt below to compare models.</div>
         ) : (
             <div className="space-y-2">
                 {messages.map((msg, i) => (
                    <div key={i} className={`p-3 rounded-lg text-sm ${msg.role === 'user' ? 'bg-primary/10 ml-8' : 'bg-surface mr-8 border border-border'}`}>
                        <div className="font-semibold mb-1 text-xs text-text-muted">{msg.role === 'user' ? 'User' : 'Assistant'}</div>
                        <pre className="whitespace-pre-wrap font-sans">{msg.content}</pre>
                    </div>
                 ))}
             </div>
         )}
      </div>

      {/* Compare Columns */}
      <div className="flex-1 overflow-x-auto p-4 flex gap-4">
         {columns.map(col => (
             <div key={col.id} className="flex-1 min-w-[300px] max-w-[500px] flex flex-col border border-border rounded-lg bg-surface overflow-hidden" data-testid={`compare-col-${col.id}`}>
                
                {/* Column Header */}
                <div className="p-3 border-b border-border bg-bg-alt flex items-center justify-between">
                    <select 
                       className="bg-surface border border-border rounded p-1 text-sm flex-1 mr-2"
                       value={col.model?.id || ""}
                       aria-label={`Select model for column ${columns.indexOf(col) + 1}`}
                       title={col.model?.label || "Select a model..."}
                       onChange={(e) => {
                           const model = availableModels.find(m => m.id === e.target.value);
                           setColumnModel(col.id, model || null);
                       }}
                       data-testid={`model-select-${col.id}`}
                    >
                        <option value="">Select a model...</option>
                        {availableModels.map(m => (
                            <option key={m.id} value={m.id}>{m.label}</option>
                        ))}
                    </select>
                    {columns.length > 1 && (
                        <button onClick={() => removeColumn(col.id)} className="text-text-muted hover:text-error shrink-0" title="Remove column">×</button>
                    )}
                </div>

                {/* Status/Metrics Bar */}
                <div className="px-3 py-2 border-b border-border bg-surface text-xs flex justify-between items-center text-text-muted">
                    <span data-testid={`state-${col.id}`} className={`
                        ${col.state === 'error' ? 'text-error font-medium' : ''}
                        ${col.state === 'waiting' ? 'text-warning' : ''}
                        ${col.state === 'streaming' ? 'text-primary' : ''}
                        ${col.state === 'complete' ? 'text-success' : ''}
                        ${col.state === 'incomplete' ? 'text-warning' : ''}
                        ${col.state === 'aborted' ? 'text-text-muted' : ''}
                        ${col.state === 'idle' ? 'text-text-muted' : ''}
                    `}>
                        {col.state.toUpperCase()}
                    </span>
                    
                    {col.metrics && (
                        <div className="flex gap-2 text-text-muted">
                            {col.metrics.durationMs != null && <span>{col.metrics.durationMs}ms</span>}
                            {col.metrics.ttftMs != null && <span>{col.metrics.ttftMs}ms TTFT</span>}
                            {col.metrics.usage?.inputTokens != null && <span>In: {col.metrics.usage.inputTokens}</span>}
                            {col.metrics.usage?.outputTokens != null && <span>Out: {col.metrics.usage.outputTokens}</span>}
                            {col.metrics.usage?.totalTokens != null && <span>Total: {col.metrics.usage.totalTokens}</span>}
                            {col.metrics.usage == null && <span>Usage: Unavailable</span>}
                        </div>
                    )}
                    
                    {(col.state === "waiting" || col.state === "streaming") && (
                        <button onClick={() => handleStopColumn(col.id)} className="text-error hover:underline" data-testid={`stop-col-${col.id}`}>Stop</button>
                    )}
                </div>

                {/* Output Area */}
                <div className="flex-1 p-3 overflow-y-auto relative">
                    {col.error ? (
                        <div className="text-error text-sm whitespace-pre-wrap">{col.error}</div>
                    ) : (
                        <pre className="whitespace-pre-wrap font-sans text-sm">{col.output}</pre>
                    )}
                </div>
             </div>
         ))}
         
         {columns.length < 4 && (
             <button 
                onClick={addColumn}
                className="w-12 border border-dashed border-border rounded-lg flex items-center justify-center text-text-muted hover:bg-surface hover:text-text-main transition-colors shrink-0"
                title="Add model column"
             >
                +
             </button>
         )}
      </div>

      {/* Input Area */}
      <div className="p-4 border-t border-border bg-bg-alt flex gap-2 items-end">
         <textarea 
            value={input}
            onChange={(e) => {
                setInput(e.target.value);
                onDraftChange?.(e.target.value);
            }}
            onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                }
            }}
            placeholder="Send a message to all selected models..."
            aria-label="Send a message to all selected models..."
            className="flex-1 bg-surface border border-border rounded-lg p-3 text-sm focus:outline-none focus:border-primary resize-none min-h-[60px] max-h-[200px]"
            disabled={isAnyStreaming}
            data-testid="compare-input"
         />
         <div className="flex flex-col gap-2 shrink-0">
             {isAnyStreaming ? (
                 <button 
                    onClick={handleStopAll}
                    className="bg-error hover:bg-error-hover text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                    data-testid="compare-stop-all"
                 >
                    Stop All
                 </button>
             ) : (
                 <button 
                    onClick={() => sendMessage()}
                    disabled={!input.trim() || columns.filter(c => c.model).length === 0}
                    className="bg-primary hover:bg-primary-hover disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                    data-testid="compare-send"
                 >
                    Send to All
                 </button>
             )}
             {messages.length > 0 && !isAnyStreaming && (
                 <button 
                    onClick={handleClear}
                    className="text-text-muted hover:text-text-main text-xs text-center"
                 >
                    Clear History
                 </button>
             )}
         </div>
      </div>
    </div>
  );
}
