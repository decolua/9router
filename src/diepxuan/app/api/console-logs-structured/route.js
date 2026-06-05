/**
 * Structured Console Logs Endpoint
 * 
 * Provides parsed, structured log data with request boundaries for the enhanced console log UI.
 * This endpoint wraps the base SSE stream and parses raw logs into structured requests.
 */

import { CONSOLE_LOG_CONFIG } from "@/shared/constants/config";

/**
 * Parse a raw log line into structured data
 */
function parseLogLine(line) {
  const timestampMatch = line.match(/^\[(\d{2}:\d{2}:\d{2})\]/);
  const tagMatch = line.match(/\[([\w:]+)\]/);
  
  const timestamp = timestampMatch ? timestampMatch[1] : null;
  const tag = tagMatch ? tagMatch[1] : null;
  
  // Extract emoji/icon
  const iconMatch = line.match(/^.\s\[([\w:]+)\]/);
  const icon = iconMatch ? line[0] : null;
  
  return {
    timestamp,
    tag,
    icon,
    raw: line,
  };
}

/**
 * Detect request boundaries from log lines
 */
function detectRequestBoundaries(logs) {
  const requests = [];
  let currentRequest = null;
  let requestCounter = 0;
  
  for (const line of logs) {
    // Start of new request: POST /v1/... or [PENDING] START
    if (line.includes('[PENDING] START') || line.match(/POST \/v\d+\//)) {
      // Save previous request if exists
      if (currentRequest) {
        requests.push(currentRequest);
      }
      
      requestCounter++;
      currentRequest = {
        id: `req-${requestCounter}`,
        startLine: line,
        startTimestamp: parseLogLine(line).timestamp,
        lines: [line],
        type: line.includes('COMBO') ? 'combo' : 'single',
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
        currentRequest.totalModels = parseInt(modelMatch[1]);
        currentRequest.models.push({
          name: modelMatch[2],
          status: 'trying',
          time: parseLogLine(line).timestamp,
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
      currentRequest.endTime = parseLogLine(line).timestamp;
    }
    
    // Model failed
    if (currentRequest && (line.includes('❌') || line.includes('unavailable') || line.includes('no connections'))) {
      const model = currentRequest.models[currentRequest.models.length - 1];
      if (model) model.status = 'failed';
    }
    
    // End of request: [PENDING] END
    if (currentRequest && line.includes('[PENDING] END')) {
      currentRequest.endTime = parseLogLine(line).timestamp;
      requests.push(currentRequest);
      currentRequest = null;
      continue;
    }
    
    // Add line to current request
    if (currentRequest) {
      currentRequest.lines.push(line);
    }
  }
  
  // Don't forget the last request
  if (currentRequest) {
    requests.push(currentRequest);
  }
  
  return requests;
}

export async function GET(request) {
  try {
    // Fetch logs from base API
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:20128';
    const response = await fetch(`${baseUrl}/api/translator/console-logs`, {
      signal: request.signal,
    });
    
    if (!response.ok) {
      return new Response(JSON.stringify({ error: 'Failed to fetch logs' }), {
        status: response.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    const data = await response.json();
    const logs = data.logs || [];
    
    // Parse and structure
    const requests = detectRequestBoundaries(logs);
    
    return new Response(JSON.stringify({
      success: true,
      requests,
      totalLines: logs.length,
      lastUpdated: new Date().toISOString(),
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[Console Logs Structured] Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}