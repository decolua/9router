"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Card, Button, Input } from "@/shared/components";

const LOG_LEVEL_COLORS = {
  INFO: "text-blue-400",
  WARN: "text-yellow-400",
  ERROR: "text-red-400",
  DEBUG: "text-purple-400",
  PENDING: "text-gray-400",
  USAGE: "text-cyan-400",
  CHAT: "text-green-400",
  COMBO: "text-orange-400",
  AUTH: "text-indigo-400",
  ROUTING: "text-pink-400",
  REQUEST: "text-teal-400",
  DBG: "text-gray-500",
  FETCH: "text-amber-400",
  STREAM: "text-emerald-400",
};

function getLevelFromLine(line) {
  const match = line.match(/\[([\w:]+)\]/);
  if (match) {
    const tag = match[1].replace(/^DBG:/, 'DBG');
    return tag.split(':')[0];
  }
  return 'LOG';
}

function getColorForLevel(level) {
  return LOG_LEVEL_COLORS[level] || "text-green-400";
}

function parseTimestamp(line) {
  const match = line.match(/^\[(\d{2}:\d{2}:\d{2})\]/);
  return match ? match[1] : null;
}

// Request List Item - Selectable
function RequestListItem({ request, isSelected, onClick }) {
  const statusIcon = request.status === 'success' ? '✓' :
                     request.status === 'failed' ? '✗' : '⏳';
  const statusColor = request.status === 'success' ? 'text-green-400' :
                      request.status === 'failed' ? 'text-red-400' : 'text-yellow-400';

  return (
    <button
      onClick={onClick}
      className={`w-full px-3 py-2 flex items-center gap-2 text-left border rounded-lg ${
        isSelected ? 'border-blue-500 bg-blue-950/20' : 'border-gray-700 hover:border-gray-500'
      }`}
    >
      <span className={statusColor}>{statusIcon}</span>
      <span className="text-xs text-gray-400">{request.startTimestamp}</span>
      <span className={`text-xs px-1.5 py-0.5 rounded ${
        request.type === 'combo' ? 'bg-orange-900/50 text-orange-300' : 'bg-blue-900/50 text-blue-300'
      }`}>
        {request.type.toUpperCase()}
      </span>
      <span className="text-sm text-gray-200 truncate flex-1">
        {request.comboName || 'Single request'}
      </span>
      {request.type === 'combo' && (
        <span className="text-xs text-gray-500">{request.models.length} models</span>
      )}

      <div className="px-3 pb-2 text-xs space-y-1 text-gray-400">
        {request.lines.length}
      </div>
    </button>
  );
}

// Timeline View for Selected Request
function RequestTimeline({ request }) {
  if (!request) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500">
        Select a request to view details
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-700 pb-2">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">
            Request {request.id}
          </h2>
          <span className={`px-2 py-0.5 rounded text-sm ${
            request.type === 'combo' ? 'bg-orange-900/50 text-orange-300' : 'bg-blue-900/50 text-blue-300'
          }`}>
            {request.type === 'combo' ? `COMBO: ${request.comboName}` : 'SINGLE'}
          </span>
          {request.status === 'success' && (
            <span className="text-green-400">✓ SUCCESS</span>
          )}
        </div>
        <div className="text-sm text-gray-400">
          {request.startTimestamp} - {request.endTime || '...'}
        </div>
      </div>

      {/* Timeline */}
      {request.type === 'combo' && request.models.length > 0 && (
        <div className="bg-gray-900 rounded-lg p-4">
          <h3 className="text-sm text-gray-400 mb-3">MODEL TIMELINE</h3>
          <div className="flex items-center gap-2 overflow-x-auto pb-2">
            {request.models.map((model, i) => (
              <div key={i} className="flex items-center gap-2 flex-shrink-0">
                <div className={`w-24 p-2 rounded border ${
                  model.status === 'success' ? 'border-green-500 bg-green-950/30' :
                  model.status === 'failed' ? 'border-red-500 bg-red-950/30' :
                  'border-gray-600 bg-gray-800'
                }`}>
                  <div className="text-xs text-gray-400 text-center mb-1">
                    Model {i + 1}/{request.models.length}
                  </div>
                  <div className="text-xs truncate text-center">
                    {model.name.split('/').pop()}
                  </div>
                  <div className={`text-center mt-1 ${
                    model.status === 'success' ? 'text-green-400' :
                    model.status === 'failed' ? 'text-red-400' : 'text-gray-400'
                  }`}>
                    {model.status === 'success' ? '✓' : model.status === 'failed' ? '✗' : '○'}
                  </div>
                </div>
                {i < request.models.length - 1 && (
                  <span className="text-gray-600">→</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Log lines */}
      <div className="bg-black rounded-lg p-4 text-xs font-mono flex-1 min-h-0 overflow-auto">
        <div className="space-y-0.5">
          {request.lines.map((line, i) => {
            const level = getLevelFromLine(line);
            const color = getColorForLevel(level);
            const timestamp = parseTimestamp(line);

            return (
              <div key={i} className="flex gap-2">
                {timestamp && (
                  <span className="text-gray-500 flex-shrink-0">{timestamp}</span>
                )}
                <span className={color}>{line}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function EnhancedConsoleLog() {
  const [requests, setRequests] = useState([]);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [rawLogs, setRawLogs] = useState([]);
  const [filter, setFilter] = useState('all'); // all, combo, single
  const [showSuccess, setShowSuccess] = useState(true);
  const [showErrors, setShowErrors] = useState(true);
  const [connected, setConnected] = useState(false);
  const logRef = useRef(null);
  const leftPanelRef = useRef(null);

  // Parse logs into requests
  const parseLogsIntoRequests = useCallback((logs) => {
    const reqList = [];
    let currentRequest = null;
    let requestCounter = 0;

    for (const line of logs) {
      // Start of new request
      // Combo: [CHAT] Combo "name" with N models
      // Single: POST /v1/... (NOT [PENDING] START - that's same request)
      const isNewCombo = line.includes('[CHAT]') && line.includes('Combo "');
      const isNewSingle = line.match(/POST \/v\d+\//);
      
      if (isNewCombo || isNewSingle) {
        if (currentRequest) {
          reqList.push(currentRequest);
        }

        requestCounter++;
        currentRequest = {
          id: `req-${requestCounter}`,
          startLine: line,
          startTimestamp: parseTimestamp(line),
          lines: [line],
          type: 'single',
          comboName: null,
          models: [],
          status: 'pending',
          endTime: null,
        };

        // Extract combo name if present
        const comboMatch = line.match(/Combo "([^"]+)"/);
        if (comboMatch) {
          currentRequest.comboName = comboMatch[1];
          currentRequest.type = 'combo';
        }

        continue;
      }

      // Track combo model attempts
      if (currentRequest && line.includes('[COMBO] Trying model')) {
        const modelMatch = line.match(/Trying model \d+\/(\d+):\s+(.+)/);
        if (modelMatch) {
          if (!currentRequest.totalModels) currentRequest.totalModels = parseInt(modelMatch[1]);
          currentRequest.models.push({
            name: modelMatch[2],
            status: 'trying',
            time: parseTimestamp(line),
          });
        }
      }

      // Model succeeded
      if (currentRequest && line.includes('[COMBO] Model') && line.includes('succeeded')) {
        const modelMatch = line.match(/Model (.+) succeeded/);
        if (modelMatch) {
          const model = currentRequest.models.find(m => m.name.includes(modelMatch[1]));
          if (model) model.status = 'success';
        }
        currentRequest.status = 'success';
        currentRequest.endTime = parseTimestamp(line);
      }

      // Model failed
      if (currentRequest && (line.includes('❌') || (line.includes('AUTH') && (line.includes('unavailable') || line.includes('no connections'))))) {
        const model = currentRequest.models[currentRequest.models.length - 1];
        if (model && model.status === 'trying') model.status = 'failed';
      }

      // End of request
      if (currentRequest && line.includes('[PENDING] END')) {
        if (currentRequest.status === 'pending') currentRequest.status = 'success'; // Default success if no explicit fail
        currentRequest.endTime = parseTimestamp(line);
        reqList.push(currentRequest);
        currentRequest = null;
        continue;
      }

      if (currentRequest) {
        currentRequest.lines.push(line);
      }
    }

    if (currentRequest) {
      reqList.push(currentRequest);
    }

    return reqList;
  }, []);

  // SSE connection for raw logs
  useEffect(() => {
    const es = new EventSource("/api/translator/console-logs/stream");

    es.onopen = () => setConnected(true);

    es.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "init") {
        setRawLogs(msg.logs);
      } else if (msg.type === "line") {
        setRawLogs(prev => [...prev, msg.line]);
      } else if (msg.type === "clear") {
        setRawLogs([]);
        setRequests([]);
        setSelectedRequest(null);
      }
    };

    es.onerror = () => setConnected(false);

    return () => es.close();
  }, []);

  // Update requests when logs change
  useEffect(() => {
    const reqs = parseLogsIntoRequests(rawLogs);
    setRequests(reqs);
  }, [rawLogs, parseLogsIntoRequests]);

  // Track if user has manually selected a request
  const [userSelectedRequest, setUserSelectedRequest] = useState(false);

  // Auto-select latest request ONLY if no user selection
  useEffect(() => {
    if (requests.length > 0 && !userSelectedRequest) {
      setSelectedRequest(requests[requests.length - 1]);
    }
  }, [requests, userSelectedRequest]);

  // Filter requests
  const filteredRequests = requests.filter(req => {
    if (filter === 'combo' && req.type !== 'combo') return false;
    if (filter === 'single' && req.type !== 'single') return false;
    if (!showSuccess && req.status === 'success') return false;
    if (!showErrors && req.status === 'failed') return false;
    return true;
  });

  const handleClear = async () => {
    try {
      await fetch("/api/translator/console-logs", { method: "DELETE" });
      setRawLogs([]);
      setRequests([]);
      setSelectedRequest(null);
      setUserSelectedRequest(false);
    } catch (err) {
      console.error("Failed to clear console logs:", err);
    }
  };

  return (
    <div className="h-[calc(100vh-120px)] flex gap-4">
      {/* Left Panel - Request List */}
      <div className="w-80 flex flex-col bg-gray-900 rounded-lg overflow-hidden">
        <div className="p-3 border-b border-gray-700">
          <div className="text-sm font-semibold mb-2">REQUESTS</div>
          <div className="flex gap-1 mb-3">
            <button
              onClick={() => setFilter('all')}
              className={`px-2 py-1 text-xs rounded ${filter === 'all' ? 'bg-blue-600' : 'bg-gray-700 hover:bg-gray-600'}`}
            >
              All
            </button>
            <button
              onClick={() => setFilter('combo')}
              className={`px-2 py-1 text-xs rounded ${filter === 'combo' ? 'bg-orange-600' : 'bg-gray-700 hover:bg-gray-600'}`}
            >
              Combo
            </button>
            <button
              onClick={() => setFilter('single')}
              className={`px-2 py-1 text-xs rounded ${filter === 'single' ? 'bg-blue-600' : 'bg-gray-700 hover:bg-gray-600'}`}
            >
              Single
            </button>
          </div>
          <div className="flex gap-2 text-xs text-gray-400">
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={showSuccess}
                onChange={(e) => setShowSuccess(e.target.checked)}
                className="w-3 h-3"
              />
              Success
            </label>
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={showErrors}
                onChange={(e) => setShowErrors(e.target.checked)}
                className="w-3 h-3"
              />
              Errors
            </label>
          </div>
        </div>

        <div ref={leftPanelRef} className="flex-1 overflow-y-auto p-2 space-y-1">
          {filteredRequests.length === 0 ? (
            <div className="text-center text-gray-500 py-8 text-sm">
              No requests
            </div>
          ) : (
            filteredRequests.map(req => (
              <RequestListItem
                key={req.id}
                request={req}
                isSelected={selectedRequest?.id === req.id}
                onClick={() => {
                  if (selectedRequest?.id === req.id) {
                    // Clicking same item → un-select, auto-select latest
                    setSelectedRequest(null);
                    setUserSelectedRequest(false);
                    // Auto-scroll to bottom (latest item)
                    if (leftPanelRef.current) {
                      leftPanelRef.current.scrollTop = leftPanelRef.current.scrollHeight;
                    }
                  } else {
                    // Clicking different item → select it
                    setSelectedRequest(req);
                    setUserSelectedRequest(true);
                  }
                }}
              />
            ))
          )}
        </div>

        <div className="p-2 border-t border-gray-700 text-xs text-gray-500">
          {filteredRequests.length} requests | {rawLogs.length} logs
        </div>
      </div>

      {/* Right Panel - Timeline Detail */}
      <div className="flex-1 bg-gray-900 rounded-lg p-4 overflow-hidden">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400' : 'bg-red-400'}`} />
            <span className="text-sm text-gray-400">
              {connected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" icon="delete" onClick={handleClear}>
              Clear
            </Button>
          </div>
        </div>

        <RequestTimeline request={selectedRequest} />
      </div>
    </div>
  );
}
