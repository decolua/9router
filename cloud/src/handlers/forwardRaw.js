import { connect } from "cloudflare:sockets";

// Forward request via raw TCP socket (bypasses CF auto headers)
export async function handleForwardRaw(request) {
  try {
    const { targetUrl, headers = {}, body } = await request.json();
    
    if (!targetUrl) {
      return new Response(JSON.stringify({ error: "targetUrl is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    const url = new URL(targetUrl);
    const host = url.hostname;
    const port = url.port || (url.protocol === "https:" ? 443 : 80);
    const path = url.pathname + url.search;
    const isHttps = url.protocol === "https:";

    console.log("[FORWARD_RAW] Connecting to:", host, port, isHttps ? "(TLS)" : "");

    // Connect to target server
    let secureSocket;
    if (isHttps) {
      // For HTTPS, connect directly with TLS enabled
      console.log("[FORWARD_RAW] Creating TLS socket...");
      secureSocket = connect({ 
        hostname: host, 
        port: parseInt(port),
        secureTransport: "on"
      });
      console.log("[FORWARD_RAW] TLS socket created");
    } else {
      secureSocket = connect({ hostname: host, port: parseInt(port) });
    }

    console.log("[FORWARD_RAW] Socket object:", secureSocket);
    console.log("[FORWARD_RAW] Socket opened:", secureSocket.opened);
    
    // Wait for socket to be ready
    try {
      console.log("[FORWARD_RAW] Waiting for socket to open...");
      await secureSocket.opened;
      console.log("[FORWARD_RAW] Socket opened successfully");
    } catch (openError) {
      console.error("[FORWARD_RAW] Socket open error:", openError.message);
      throw openError;
    }

    console.log("[FORWARD_RAW] Getting writer and reader...");
    const writer = secureSocket.writable.getWriter();
    const reader = secureSocket.readable.getReader();
    console.log("[FORWARD_RAW] Writer and reader obtained");

    // Build raw HTTP request
    const bodyStr = JSON.stringify(body);
    const requestHeaders = {
      "Host": host,
      "Content-Type": "application/json",
      "Content-Length": new TextEncoder().encode(bodyStr).length.toString(),
      "Connection": "close",
      ...headers
    };

    // Build HTTP request string
    let httpRequest = `POST ${path} HTTP/1.1\r\n`;
    for (const [key, value] of Object.entries(requestHeaders)) {
      httpRequest += `${key}: ${value}\r\n`;
    }
    httpRequest += `\r\n${bodyStr}`;

    console.log("[FORWARD_RAW] Sending request:", httpRequest.substring(0, 300));
    console.log("[FORWARD_RAW] Full request length:", httpRequest.length);

    // Send request
    try {
      console.log("[FORWARD_RAW] Writing to socket...");
      await writer.write(new TextEncoder().encode(httpRequest));
      console.log("[FORWARD_RAW] Write complete, closing writer...");
      await writer.close();
      console.log("[FORWARD_RAW] Writer closed");
    } catch (writeError) {
      console.error("[FORWARD_RAW] Write error:", writeError.message);
      throw writeError;
    }

    // Read response with timeout
    console.log("[FORWARD_RAW] Starting to read response...");
    let responseData = new Uint8Array(0);
    let attempts = 0;
    const maxAttempts = 100; // 10 seconds max
    
    while (attempts < maxAttempts) {
      console.log("[FORWARD_RAW] Reading attempt:", attempts);
      const { done, value } = await reader.read();
      console.log("[FORWARD_RAW] Read result - done:", done, "value length:", value?.length);
      if (done) break;
      if (value) {
        const newData = new Uint8Array(responseData.length + value.length);
        newData.set(responseData);
        newData.set(value, responseData.length);
        responseData = newData;
        
        // Check if we have complete response (has headers end marker)
        const text = new TextDecoder().decode(responseData);
        if (text.includes("\r\n\r\n")) {
          // Check if we have Content-Length and received all body
          const headerEnd = text.indexOf("\r\n\r\n");
          const headers = text.substring(0, headerEnd).toLowerCase();
          const contentLengthMatch = headers.match(/content-length:\s*(\d+)/);
          if (contentLengthMatch) {
            const expectedLength = parseInt(contentLengthMatch[1]);
            const bodyReceived = text.length - headerEnd - 4;
            if (bodyReceived >= expectedLength) {
              console.log("[FORWARD_RAW] Complete response received");
              break;
            }
          }
        }
      }
      attempts++;
    }
    
    console.log("[FORWARD_RAW] Read loop finished, total bytes:", responseData.length);

    const responseText = new TextDecoder().decode(responseData);
    console.log("[FORWARD_RAW] Response received:", responseText.substring(0, 500));

    // Parse HTTP response
    const headerEndIndex = responseText.indexOf("\r\n\r\n");
    if (headerEndIndex === -1) {
      console.log("[FORWARD_RAW] Full response data:", responseText);
      throw new Error("Invalid HTTP response - no header end found");
    }

    const headerPart = responseText.substring(0, headerEndIndex);
    const bodyPart = responseText.substring(headerEndIndex + 4);

    // Parse status line
    const statusLine = headerPart.split("\r\n")[0];
    const statusMatch = statusLine.match(/HTTP\/[\d.]+ (\d+)/);
    const status = statusMatch ? parseInt(statusMatch[1]) : 200;

    // Parse headers
    const responseHeaders = {};
    const headerLines = headerPart.split("\r\n").slice(1);
    for (const line of headerLines) {
      const colonIndex = line.indexOf(":");
      if (colonIndex > 0) {
        const key = line.substring(0, colonIndex).trim();
        const value = line.substring(colonIndex + 1).trim();
        responseHeaders[key.toLowerCase()] = value;
      }
    }

    return new Response(bodyPart, {
      status,
      headers: {
        "Content-Type": responseHeaders["content-type"] || "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    });

  } catch (error) {
    console.error("[FORWARD_RAW] Error:", error.message, error.stack);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}

