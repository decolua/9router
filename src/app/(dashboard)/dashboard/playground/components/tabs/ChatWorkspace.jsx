import React, { useState, useRef, useEffect, useCallback } from "react";
import { buildPlaygroundRequest } from "../../lib/requestBuilder";
import { createSseParser } from "../../lib/sseParser";
import { computeMetrics } from "../../lib/metrics.js";

export default function ChatWorkspace({ configState, onMetricsUpdate }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState(null);
  const abortControllerRef = useRef(null);
  
  // Create a ref for stable metrics calculation state across stream events
  const streamStateRef = useRef({
    startedAt: null,
    firstChunkAt: null,
    tokensIn: 0,
    tokensOut: 0,
    pricing: null
  });

  const appendToLastMessage = useCallback((textDelta) => {
    setMessages((prev) => {
      const newMessages = [...prev];
      if (newMessages.length === 0 || newMessages[newMessages.length - 1].role === "user") {
        newMessages.push({ role: "assistant", content: textDelta, partial: true });
      } else {
        const lastMsg = newMessages[newMessages.length - 1];
        lastMsg.content += textDelta;
      }
      return newMessages;
    });
  }, []);

  const handleStop = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsStreaming(false);
    setMessages((prev) => {
       const newMessages = [...prev];
       if (newMessages.length > 0) {
           const lastMsg = newMessages[newMessages.length - 1];
           if (lastMsg.role === "assistant") {
               lastMsg.partial = false; // preserve as full message
           }
       }
       return newMessages;
    });
  }, []);
  
  const sendMessage = useCallback(async (forcedMessages = null) => {
    if (isStreaming) return;
    
    let currentMessages = forcedMessages;
    if (!currentMessages) {
       if (!input.trim()) return;
       const newMsg = { role: "user", content: input };
       currentMessages = [...messages, newMsg];
       setMessages(currentMessages);
       setInput("");
    }
    
    setError(null);
    setIsStreaming(true);
    
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    // Reset stream metrics state
    streamStateRef.current = {
      startedAt: Date.now(),
      firstChunkAt: null,
      tokensIn: 0,
      tokensOut: 0,
      pricing: configState.model?.pricing || null
    };

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
      
      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}`);
      }
      
      const parser = createSseParser();
      const reader = response.body.getReader();
      
      // Initialize assistant message
      setMessages((prev) => [...prev, { role: "assistant", content: "", partial: true }]);

      while (true) {
        const { done, value } = await reader.read();
        
        let events = [];
        if (value) {
            events = parser.push(value);
        }
        if (done) {
            const trailingEvent = parser.close();
            if (trailingEvent) events.push(trailingEvent);
        }
        
        for (const event of events) {
           if (event.type === "delta" && event.text) {
               if (streamStateRef.current.firstChunkAt === null) {
                   streamStateRef.current.firstChunkAt = Date.now();
               }
               appendToLastMessage(event.text);
           } else if (event.type === "usage") {
               streamStateRef.current.tokensIn = event.usage.inputTokens || 0;
               streamStateRef.current.tokensOut = event.usage.outputTokens || 0;
           } else if (event.type === "error") {
               throw new Error(event.message);
           } else if (event.type === "incomplete" && !abortController.signal.aborted) {
               setError("Stream ended unexpectedly.");
           }
        }
        
        if (done) break;
      }
      
      // Mark complete
      setMessages((prev) => {
         const newMessages = [...prev];
         if (newMessages.length > 0) {
             const lastMsg = newMessages[newMessages.length - 1];
             if (lastMsg.role === "assistant") {
                 lastMsg.partial = false;
             }
         }
         return newMessages;
      });

    } catch (err) {
      if (err.name === "AbortError") {
        // preserve partial, handleStop already did partial=false
      } else {
        setError(err.message);
        setMessages((prev) => {
           const newMessages = [...prev];
           if (newMessages.length > 0) {
               const lastMsg = newMessages[newMessages.length - 1];
               if (lastMsg.role === "assistant" && lastMsg.partial) {
                   lastMsg.partial = false;
               }
           }
           return newMessages;
        });
      }
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
      
      // Compute and report final metrics
      if (onMetricsUpdate) {
         const metrics = computeMetrics({
            startedAt: streamStateRef.current.startedAt,
            firstChunkAt: streamStateRef.current.firstChunkAt,
            finishedAt: Date.now(),
            tokensIn: streamStateRef.current.tokensIn,
            tokensOut: streamStateRef.current.tokensOut,
            pricing: streamStateRef.current.pricing ? {
                inUsdPer1k: streamStateRef.current.pricing.prompt_usd_per_1k,
                outUsdPer1k: streamStateRef.current.pricing.completion_usd_per_1k,
                estimated: true
            } : undefined
         });
         onMetricsUpdate(metrics);
      }
    }
  }, [input, messages, isStreaming, configState, appendToLastMessage, onMetricsUpdate]);

  const handleRegenerate = useCallback(() => {
    if (messages.length === 0 || isStreaming) return;
    
    // Remove last assistant message
    const newMessages = [...messages];
    if (newMessages[newMessages.length - 1].role === "assistant") {
        newMessages.pop();
    }
    setMessages(newMessages);
    sendMessage(newMessages);
  }, [messages, isStreaming, sendMessage]);

  const handleClear = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  return (
    <div className="flex flex-col h-full relative" data-testid="playground-chat-workspace">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg, i) => (
          <div key={i} className={`p-4 rounded-lg ${msg.role === 'user' ? 'bg-primary/10 ml-8' : 'bg-surface mr-8 border border-border'}`}>
             <div className="font-semibold mb-1 text-sm text-text-muted">{msg.role === 'user' ? 'User' : 'Assistant'}</div>
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
                 >
                    Regenerate
                 </button>
             )}
             {messages.length > 0 && !isStreaming && (
                 <button 
                    onClick={handleClear}
                    className="text-text-muted hover:text-text-main text-xs text-center"
                 >
                    Clear
                 </button>
             )}
         </div>
      </div>
    </div>
  );
}