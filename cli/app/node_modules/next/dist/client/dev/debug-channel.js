"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    createDebugChannel: null,
    getOrCreateDebugChannelReadableWriterPair: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    createDebugChannel: function() {
        return createDebugChannel;
    },
    getOrCreateDebugChannelReadableWriterPair: function() {
        return getOrCreateDebugChannelReadableWriterPair;
    }
});
const _approuterheaders = require("../components/app-router-headers");
const _invarianterror = require("../../shared/lib/invariant-error");
const pairs = new Map();
const DEBUG_CHANNEL_STORAGE_KEY_PREFIX = '__next_debug_channel:';
// Buffer for the initial document's debug channel data. Written to
// sessionStorage once complete so it can be restored when the browser serves
// the page from HTTP cache (back-forward navigation, tab duplication, etc.).
let initialDocumentDebugChunks = [];
function persistDebugChannelToSessionStorage(requestId) {
    const key = DEBUG_CHANNEL_STORAGE_KEY_PREFIX + requestId;
    const value = JSON.stringify(initialDocumentDebugChunks.map((chunk)=>{
        let binary = '';
        for(let i = 0; i < chunk.byteLength; i++){
            binary += String.fromCharCode(chunk[i]);
        }
        return btoa(binary);
    }));
    try {
        sessionStorage.setItem(key, value);
    } catch  {
        // Likely a quota error. Drop entries from previous documents in this tab
        // (we only need to restore the current one's entry on cache restore) and
        // retry once. If it still fails, skip silently — the location.reload()
        // fallback in createDebugChannel handles this case.
        for(let i = sessionStorage.length - 1; i >= 0; i--){
            const k = sessionStorage.key(i);
            if (k?.startsWith(DEBUG_CHANNEL_STORAGE_KEY_PREFIX) && k !== key) {
                sessionStorage.removeItem(k);
            }
        }
        try {
            sessionStorage.setItem(key, value);
        } catch  {}
    }
}
function wasServedFromCache() {
    try {
        // There is exactly one PerformanceNavigationTiming entry per page load.
        const entry = performance.getEntriesByType('navigation')[0];
        return entry?.transferSize === 0;
    } catch  {
        return false;
    }
}
function restoreDebugChannelFromSessionStorage(requestId) {
    try {
        const serializedData = sessionStorage.getItem(DEBUG_CHANNEL_STORAGE_KEY_PREFIX + requestId);
        if (!serializedData) {
            return undefined;
        }
        const chunks = JSON.parse(serializedData).map((base64)=>{
            const binary = atob(base64);
            const bytes = new Uint8Array(binary.length);
            for(let i = 0; i < binary.length; i++){
                bytes[i] = binary.charCodeAt(i);
            }
            return bytes;
        });
        return new ReadableStream({
            start (controller) {
                for (const chunk of chunks){
                    controller.enqueue(chunk);
                }
                controller.close();
            }
        });
    } catch  {
        return undefined;
    }
}
function getOrCreateDebugChannelReadableWriterPair(requestId) {
    let pair = pairs.get(requestId);
    if (!pair) {
        // Only buffer chunks for the initial document's debug channel, not for
        // client-side navigation requests.
        const shouldBuffer = requestId === self.__next_r;
        const { readable, writable } = new TransformStream({
            transform (chunk, controller) {
                if (shouldBuffer) {
                    initialDocumentDebugChunks.push(chunk.slice());
                }
                controller.enqueue(chunk);
            }
        });
        pair = {
            readable,
            writer: writable.getWriter()
        };
        pairs.set(requestId, pair);
        pair.writer.closed.then(()=>{
            if (shouldBuffer) {
                persistDebugChannelToSessionStorage(requestId);
            }
        }).finally(()=>pairs.delete(requestId));
    }
    return pair;
}
function createDebugChannel(requestHeaders) {
    let requestId;
    if (requestHeaders) {
        requestId = requestHeaders[_approuterheaders.NEXT_REQUEST_ID_HEADER] ?? undefined;
        if (!requestId) {
            throw Object.defineProperty(new _invarianterror.InvariantError(`Expected a ${JSON.stringify(_approuterheaders.NEXT_REQUEST_ID_HEADER)} request header.`), "__NEXT_ERROR_CODE", {
                value: "E854",
                enumerable: false,
                configurable: true
            });
        }
    } else {
        requestId = self.__next_r;
        if (!requestId) {
            throw Object.defineProperty(new _invarianterror.InvariantError(`Expected a request ID to be defined for the document via self.__next_r.`), "__NEXT_ERROR_CODE", {
                value: "E806",
                enumerable: false,
                configurable: true
            });
        }
    }
    // Only attempt to restore the sessionStorage debug channel entry for the
    // initial document load (no request headers). Client-side navigations pass
    // request headers and should always use the WebSocket-backed debug channel.
    if (!requestHeaders && wasServedFromCache()) {
        const readable = restoreDebugChannelFromSessionStorage(requestId);
        if (readable) {
            return {
                readable
            };
        }
        // Debug channel can't be restored — debug deps would block hydration.
        // Force a fresh page load from the server. Return a never-closing stream
        // so the Flight client stays parked until the reload tears the document
        // down, instead of synchronously erroring with "Connection closed.".
        location.reload();
        return {
            readable: new ReadableStream()
        };
    }
    const { readable } = getOrCreateDebugChannelReadableWriterPair(requestId);
    return {
        readable
    };
}

if ((typeof exports.default === 'function' || (typeof exports.default === 'object' && exports.default !== null)) && typeof exports.default.__esModule === 'undefined') {
  Object.defineProperty(exports.default, '__esModule', { value: true });
  Object.assign(exports.default, exports);
  module.exports = exports.default;
}

//# sourceMappingURL=debug-channel.js.map