"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    connectReactDebugChannel: null,
    connectReactDebugChannelForHtmlRequest: null,
    deleteReactDebugChannelForHtmlRequest: null,
    setReactDebugChannelForHtmlRequest: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    connectReactDebugChannel: function() {
        return connectReactDebugChannel;
    },
    connectReactDebugChannelForHtmlRequest: function() {
        return connectReactDebugChannelForHtmlRequest;
    },
    deleteReactDebugChannelForHtmlRequest: function() {
        return deleteReactDebugChannelForHtmlRequest;
    },
    setReactDebugChannelForHtmlRequest: function() {
        return setReactDebugChannelForHtmlRequest;
    }
});
const _nodewebstreamshelper = require("../stream-utils/node-web-streams-helper");
const _hotreloadertypes = require("./hot-reloader-types");
const reactDebugChannelsByHtmlRequestId = new Map();
function connectReactDebugChannel(requestId, debugChannel, sendToClient) {
    const reader = debugChannel.readable.pipeThrough(// We're sending the chunks in batches to reduce overhead in the browser.
    (0, _nodewebstreamshelper.createBufferedTransformStream)({
        maxBufferByteLength: 128 * 1024
    })).getReader();
    const stop = ()=>{
        sendToClient({
            type: _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.REACT_DEBUG_CHUNK,
            requestId,
            chunk: null
        });
    };
    const onError = (err)=>{
        console.error(Object.defineProperty(new Error('React debug channel stream error', {
            cause: err
        }), "__NEXT_ERROR_CODE", {
            value: "E810",
            enumerable: false,
            configurable: true
        }));
        stop();
    };
    const progress = (entry)=>{
        if (entry.done) {
            stop();
        } else {
            sendToClient({
                type: _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.REACT_DEBUG_CHUNK,
                requestId,
                chunk: entry.value
            });
            reader.read().then(progress, onError);
        }
    };
    reader.read().then(progress, onError);
}
function connectReactDebugChannelForHtmlRequest(htmlRequestId, sendToClient) {
    const debugChannel = reactDebugChannelsByHtmlRequestId.get(htmlRequestId);
    if (!debugChannel) {
        return;
    }
    reactDebugChannelsByHtmlRequestId.delete(htmlRequestId);
    connectReactDebugChannel(htmlRequestId, debugChannel, sendToClient);
}
function setReactDebugChannelForHtmlRequest(htmlRequestId, debugChannel) {
    // TODO: Clean up after a timeout, in case the client never connects, e.g.
    // when CURL'ing the page, or loading the page with JavaScript disabled etc.
    reactDebugChannelsByHtmlRequestId.set(htmlRequestId, debugChannel);
}
function deleteReactDebugChannelForHtmlRequest(htmlRequestId) {
    reactDebugChannelsByHtmlRequestId.delete(htmlRequestId);
}

//# sourceMappingURL=debug-channel.js.map