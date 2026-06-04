"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    createProcessTurbopackMessage: null,
    createWebSocket: null,
    useWebSocketPing: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    createProcessTurbopackMessage: function() {
        return createProcessTurbopackMessage;
    },
    createWebSocket: function() {
        return createWebSocket;
    },
    useWebSocketPing: function() {
        return useWebSocketPing;
    }
});
const _react = require("react");
const _approutercontextsharedruntime = require("../../../../shared/lib/app-router-context.shared-runtime");
const _getsocketurl = require("../get-socket-url");
const _hotreloadertypes = require("../../../../server/dev/hot-reloader-types");
const _shared = require("../shared");
const _hotreloaderapp = require("./hot-reloader-app");
const _forwardlogs = require("../../../../next-devtools/userspace/app/forward-logs");
const _invarianterror = require("../../../../shared/lib/invariant-error");
const _constants = require("../../../../lib/constants");
let reconnections = 0;
let reloading = false;
let serverSessionId = null;
let mostRecentCompilationHash = null;
function createWebSocket(assetPrefix, staticIndicatorState) {
    if (!self.__next_r) {
        throw Object.defineProperty(new _invarianterror.InvariantError(`Expected a request ID to be defined for the document via self.__next_r.`), "__NEXT_ERROR_CODE", {
            value: "E806",
            enumerable: false,
            configurable: true
        });
    }
    let webSocket;
    let timer;
    const sendMessage = (data)=>{
        if (webSocket && webSocket.readyState === webSocket.OPEN) {
            webSocket.send(data);
        }
    };
    const processTurbopackMessage = createProcessTurbopackMessage(sendMessage);
    function init() {
        if (webSocket) {
            webSocket.close();
        }
        const newWebSocket = new window.WebSocket(`${(0, _getsocketurl.getSocketUrl)(assetPrefix)}/_next/webpack-hmr?id=${self.__next_r}`);
        newWebSocket.binaryType = 'arraybuffer';
        function handleOnline() {
            _forwardlogs.logQueue.onSocketReady(newWebSocket);
            reconnections = 0;
            window.console.log('[HMR] connected');
        }
        function handleMessage(event) {
            // While the page is reloading, don't respond to any more messages.
            if (reloading) {
                return;
            }
            try {
                const message = event.data instanceof ArrayBuffer ? parseBinaryMessage(event.data) : JSON.parse(event.data);
                // Check for server restart in Turbopack mode
                if (message.type === _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.TURBOPACK_CONNECTED) {
                    if (serverSessionId !== null && serverSessionId !== message.data.sessionId) {
                        // Either the server's session id has changed and it's a new server, or
                        // it's been too long since we disconnected and we should reload the page.
                        window.location.reload();
                        reloading = true;
                        return;
                    }
                    serverSessionId = message.data.sessionId;
                }
                // Track webpack compilation hash for server restart detection
                if (message.type === _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.SYNC && 'hash' in message) {
                    // If we had previously reconnected and the hash changed, the server may have restarted
                    if (mostRecentCompilationHash !== null && mostRecentCompilationHash !== message.hash) {
                        window.location.reload();
                        reloading = true;
                        return;
                    }
                    mostRecentCompilationHash = message.hash;
                }
                (0, _hotreloaderapp.processMessage)(message, sendMessage, processTurbopackMessage, staticIndicatorState);
            } catch (err) {
                (0, _shared.reportInvalidHmrMessage)(event, err);
            }
        }
        function handleDisconnect() {
            newWebSocket.onerror = null;
            newWebSocket.onclose = null;
            newWebSocket.close();
            reconnections++;
            // After 25 reconnects we'll want to reload the page as it indicates the dev server is no longer running.
            if (reconnections > _constants.WEB_SOCKET_MAX_RECONNECTIONS) {
                reloading = true;
                window.location.reload();
                return;
            }
            clearTimeout(timer);
            // Try again after 5 seconds
            timer = setTimeout(init, reconnections > 5 ? 5000 : 1000);
        }
        newWebSocket.onopen = handleOnline;
        newWebSocket.onerror = handleDisconnect;
        newWebSocket.onclose = handleDisconnect;
        newWebSocket.onmessage = handleMessage;
        webSocket = newWebSocket;
        return newWebSocket;
    }
    return init();
}
function createProcessTurbopackMessage(sendMessage) {
    if (!process.env.TURBOPACK) {
        return ()=>{};
    }
    let queue = [];
    let callback;
    const processTurbopackMessage = (msg)=>{
        if (callback) {
            callback(msg);
        } else {
            queue.push(msg);
        }
    };
    import(// @ts-expect-error requires "moduleResolution": "node16" in tsconfig.json and not .ts extension
    '@vercel/turbopack-ecmascript-runtime/browser/dev/hmr-client/hmr-client.ts').then(({ connect })=>{
        connect({
            addMessageListener (cb) {
                callback = cb;
                // Replay all Turbopack messages before we were able to establish the HMR client.
                for (const msg of queue){
                    cb(msg);
                }
                queue.length = 0;
            },
            sendMessage,
            onUpdateError: (err)=>(0, _hotreloaderapp.performFullReload)(err, sendMessage)
        });
    });
    return processTurbopackMessage;
}
function useWebSocketPing(webSocket) {
    const { tree } = (0, _react.useContext)(_approutercontextsharedruntime.GlobalLayoutRouterContext);
    (0, _react.useEffect)(()=>{
        if (!webSocket) {
            throw Object.defineProperty(new _invarianterror.InvariantError('Expected webSocket to be defined in dev mode.'), "__NEXT_ERROR_CODE", {
                value: "E785",
                enumerable: false,
                configurable: true
            });
        }
        // Never send pings when using Turbopack as it's not used.
        // Pings were originally used to keep track of active routes in on-demand-entries with webpack.
        if (process.env.TURBOPACK) {
            return;
        }
        // Taken from on-demand-entries-client.js
        const interval = setInterval(()=>{
            if (webSocket.readyState === webSocket.OPEN) {
                webSocket.send(JSON.stringify({
                    event: 'ping',
                    tree,
                    appDirRoute: true
                }));
            }
        }, 2500);
        return ()=>clearInterval(interval);
    }, [
        tree,
        webSocket
    ]);
}
const textDecoder = new TextDecoder();
function parseBinaryMessage(data) {
    assertByteLength(data, 1);
    const view = new DataView(data);
    const messageType = view.getUint8(0);
    switch(messageType){
        case _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.ERRORS_TO_SHOW_IN_BROWSER:
            {
                const serializedErrors = new Uint8Array(data, 1);
                return {
                    type: _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.ERRORS_TO_SHOW_IN_BROWSER,
                    serializedErrors
                };
            }
        case _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.REACT_DEBUG_CHUNK:
            {
                assertByteLength(data, 2);
                const requestIdLength = view.getUint8(1);
                assertByteLength(data, 2 + requestIdLength);
                const requestId = textDecoder.decode(new Uint8Array(data, 2, requestIdLength));
                const chunk = data.byteLength > 2 + requestIdLength ? new Uint8Array(data, 2 + requestIdLength) : null;
                return {
                    type: _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.REACT_DEBUG_CHUNK,
                    requestId,
                    chunk
                };
            }
        default:
            {
                throw Object.defineProperty(new _invarianterror.InvariantError(`Invalid binary HMR message of type ${messageType}`), "__NEXT_ERROR_CODE", {
                    value: "E809",
                    enumerable: false,
                    configurable: true
                });
            }
    }
}
function assertByteLength(data, expectedLength) {
    if (data.byteLength < expectedLength) {
        throw Object.defineProperty(new _invarianterror.InvariantError(`Invalid binary HMR message: insufficient data (expected ${expectedLength} bytes, got ${data.byteLength})`), "__NEXT_ERROR_CODE", {
            value: "E808",
            enumerable: false,
            configurable: true
        });
    }
}

if ((typeof exports.default === 'function' || (typeof exports.default === 'object' && exports.default !== null)) && typeof exports.default.__esModule === 'undefined') {
  Object.defineProperty(exports.default, '__esModule', { value: true });
  Object.assign(exports.default, exports);
  module.exports = exports.default;
}

//# sourceMappingURL=web-socket.js.map