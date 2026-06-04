/**
 * Shared utilities for MCP tools that communicate with the browser.
 * This module provides a common infrastructure for request-response
 * communication between MCP endpoints and browser sessions via HMR.
 */ "use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    DEFAULT_BROWSER_REQUEST_TIMEOUT_MS: null,
    createBrowserRequest: null,
    handleBrowserPageResponse: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    DEFAULT_BROWSER_REQUEST_TIMEOUT_MS: function() {
        return DEFAULT_BROWSER_REQUEST_TIMEOUT_MS;
    },
    createBrowserRequest: function() {
        return createBrowserRequest;
    },
    handleBrowserPageResponse: function() {
        return handleBrowserPageResponse;
    }
});
const _nanoid = require("next/dist/compiled/nanoid");
const DEFAULT_BROWSER_REQUEST_TIMEOUT_MS = 5000;
const pendingRequests = new Map();
function createBrowserRequest(messageType, sendHmrMessage, getActiveConnectionCount, timeoutMs) {
    const connectionCount = getActiveConnectionCount();
    if (connectionCount === 0) {
        return Promise.resolve([]);
    }
    const requestId = `mcp-${messageType}-${(0, _nanoid.nanoid)()}`;
    const responsePromise = new Promise((resolve, reject)=>{
        const timeout = setTimeout(()=>{
            const pending = pendingRequests.get(requestId);
            if (pending && pending.responses.length > 0) {
                resolve(pending.responses);
            } else {
                reject(Object.defineProperty(new Error(`Timeout waiting for response from frontend. The browser may not be responding to HMR messages.`), "__NEXT_ERROR_CODE", {
                    value: "E825",
                    enumerable: false,
                    configurable: true
                }));
            }
            pendingRequests.delete(requestId);
        }, timeoutMs);
        pendingRequests.set(requestId, {
            responses: [],
            expectedCount: connectionCount,
            resolve: resolve,
            reject,
            timeout
        });
    });
    sendHmrMessage({
        type: messageType,
        requestId
    });
    return responsePromise;
}
function handleBrowserPageResponse(requestId, data, url) {
    if (!url) {
        throw Object.defineProperty(new Error('URL is required in MCP browser response. This is a bug in Next.js.'), "__NEXT_ERROR_CODE", {
            value: "E824",
            enumerable: false,
            configurable: true
        });
    }
    const pending = pendingRequests.get(requestId);
    if (pending) {
        pending.responses.push({
            url,
            data
        });
        if (pending.responses.length >= pending.expectedCount) {
            clearTimeout(pending.timeout);
            pending.resolve(pending.responses);
            pendingRequests.delete(requestId);
        }
    }
}

//# sourceMappingURL=browser-communication.js.map