import React, { useState, useRef, useEffect, useCallback } from "react";
import { buildPlaygroundRequest } from "../../lib/requestBuilder";
import { createSseParser } from "../../lib/sseParser";
import { createMetricAccumulator } from "../../lib/metrics.js";

export default function ChatWorkspace({ configState, onMetricsUpdate }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState(null);
  const abortControllerRef = useRef(null);

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, []);

  const handleStop = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setIsStreaming(false);
  }, []);
  
  const sendMessage = useCallback(async (forcedMessages = null) => {
    if (isStreaming) return;
    
    if (!configState?.model?.id) {
        setError("A selected model is required.");
        return;
    }

    let currentMessages = forcedMessages;
    if (!currentMessages) {
       if (!input.trim()) return;
       const newMsg = { role: "user", content: input, partial: false };
       currentMessages = [...messages, newMsg];
       setMessages(currentMessages);
       setInput("");
    }
    
    setError(null);
    setIsStreaming(true);
    
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    const accumulator = createMetricAccumulator(Date.now());
    
    const isCurrent = () => abortControllerRef.current === abortController;

    try {
      const requestBody = buildPlaygroundRequest({
        model: configState.model,
        systemPrompt: configState.systemPrompt,
        messages: currentMessages,
        controls: configState.params,
        images: [] 
      });
      
      const response = await fetch("/api/dashboard/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
        signal: abortController.signal
      });
      
      if (!isCurrent()) return;

      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}`);
      }
      
      const parser = createSseParser();
      const reader = response.body.getReader();
      setMessages((prev) => [...prev, { role: "assistant", content: "", partial: true }]);

      while (true) {
        const { done, value } = await reader.read();
        if (!isCurrent()) { reader.cancel().catch(() => {}); return; }
        
        if (done) {
            const closeEvent = parser.close();
            if (closeEvent) accumulator.record(closeEvent, Date.now());
            break;
        }

        const events = parser.push(value);
        
        for (const event of events) {
           accumulator.record(event, Date.now());
           if (!isCurrent()) { reader.cancel().catch(() => {}); return; }
           
           if (event.type === "delta" && event.text) {
               if (isCurrent()) {
                   setMessages((prev) => {
                       if (prev.length === 0) return prev;
                       const lastIndex = prev.length - 1;
                       const lastMsg = prev[lastIndex];
                       if (lastMsg.role !== "assistant") return prev;
                       return [
                           ...prev.slice(0, lastIndex),
                           { ...lastMsg, content: lastMsg.content + event.text }
                       ];
                   });
               }
           } else if (event.type === "malformed") {
               accumulator.record({ type: "error", message: "Malformed stream frame received" }, Date.now());
               reader.cancel().catch(() => {});
               throw new Error("Malformed stream frame received");
           } else if (event.type === "error") {
               accumulator.record(event, Date.now());
               reader.cancel().catch(() => {});
               throw new Error(event.message);
           }

           const snap = accumulator.snapshot();
           if (snap.terminalState) {
               reader.cancel().catch(() => {});
               if (isCurrent()) {
                   if (snap.terminalState === "complete") {
                       setMessages((prev) => {
                          if (prev.length === 0) return prev;
                          const lastIndex = prev.length - 1;
                          const lastMsg = prev[lastIndex];
                          if (lastMsg.role !== "assistant") return prev;
                          return [
                              ...prev.slice(0, lastIndex),
                              { ...lastMsg, partial: false }
                          ];
                       });
                   } else if (snap.terminalState === "incomplete") {
                       setError("Stream ended unexpectedly.");
                   }
               }
               return;
           }
        }
      }

      if (!isCurrent()) return;
      
      const snapEOF = accumulator.snapshot();
      if (snapEOF.terminalState === "incomplete") {
          setError("Stream ended unexpectedly.");
      } else if (snapEOF.terminalState === "complete") {
          setMessages((prev) => {
             if (prev.length === 0) return prev;
             const lastIndex = prev.length - 1;
             const lastMsg = prev[lastIndex];
             if (lastMsg.role !== "assistant") return prev;
             return [
                 ...prev.slice(0, lastIndex),
                 { ...lastMsg, partial: false }
             ];
          });
      }

    } catch (err) {
      if (!isCurrent()) return;

      if (err.name === "AbortError") {
        accumulator.abort(Date.now());
      } else {
        accumulator?.record?.({ type: "error", message: err.message }, Date.now());
        setError(err.message);
      }
    } finally {
      if (isCurrent()) {
          abortControllerRef.current = null;
          setIsStreaming(false);
          const snap = accumulator.snapshot();
          if (onMetricsUpdate && snap.terminalState !== null) {
             onMetricsUpdate(snap);
          }
      }
    }
  }, [input, messages, isStreaming, configState, onMetricsUpdate]);

  const handleRegenerate = useCallback(() => {
    if (messages.length === 0 || isStreaming) return;
    
    const newMessages = [...messages];
    if (newMessages[newMessages.length - 1].role === "assistant") {
        newMessages.pop();
    }
    setMessages(newMessages);
    sendMessage(newMessages);
  }, [messages, isStreaming, sendMessage]);

  const handleClear = useCallback(() => {
    if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
    }
    setIsStreaming(false);
    setMessages([]);
    setError(null);
  }, []);

  return (
    <div className="flex flex-col h-full relative" data-testid="playground-chat-workspace">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg, i) => (
          <div key={i} className={`p-4 rounded-lg ${msg.role === 'user' ? 'bg-primary/10 ml-8' : 'bg-surface mr-8 border border-border'}`}>
             <div className="flex justify-between items-center mb-1">
                 <div className="font-semibold text-sm text-text-muted">{msg.role === 'user' ? 'User' : 'Assistant'}</div>
                 {msg.partial && <span className="text-xs bg-warning/20 text-warning px-2 py-0.5 rounded" data-testid="partial-indicator">Partial</span>}
             </div>
             <pre className="whitespace-pre-wrap font-sans text-sm">{msg.content}</pre>
          </div>
        ))}
        {error && (
            <div className="p-4 bg-error/10 text-error rounded-lg text-sm border border-error/20" data-testid="chat-error">
                {error}
            </div>
        )}
      </div>
      
      <div className="p-4 border-t border-border bg-bg-alt flex gap-2 items-end">
         <textarea 
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                }
            }}
            placeholder="Send a message..."
            className="flex-1 bg-surface border border-border rounded-lg p-3 text-sm focus:outline-none focus:border-primary resize-none min-h-[60px] max-h-[200px]"
            disabled={isStreaming}
         />
         <div className="flex flex-col gap-2 shrink-0">
             {isStreaming ? (
                 <button 
                    onClick={handleStop}
                    className="bg-error hover:bg-error-hover text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                    data-testid="playground-stop"
                 >
                    Stop
                 </button>
             ) : (
                 <button 
                    onClick={() => sendMessage()}
                    disabled={!input.trim()}
                    className="bg-primary hover:bg-primary-hover disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                    data-testid="playground-send"
                 >
                    Send
                 </button>
             )}
             {messages.length > 0 && !isStreaming && (
                 <button 
                    onClick={handleRegenerate}
                    className="text-text-muted hover:text-text-main text-xs text-center"
                    data-testid="playground-regenerate"
                 >
                    Regenerate
                 </button>
             )}
             {messages.length > 0 && !isStreaming && (
                 <button 
                    onClick={handleClear}
                    className="text-text-muted hover:text-text-main text-xs text-center"
                    data-testid="playground-clear"
                 >
                    Clear
                 </button>
             )}
         </div>
      </div>
    </div>
  );
}