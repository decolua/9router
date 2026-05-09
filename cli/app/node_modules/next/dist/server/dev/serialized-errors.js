"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    deleteErrorsRscStreamForHtmlRequest: null,
    sendSerializedErrorsToClient: null,
    sendSerializedErrorsToClientForHtmlRequest: null,
    setErrorsRscStreamForHtmlRequest: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    deleteErrorsRscStreamForHtmlRequest: function() {
        return deleteErrorsRscStreamForHtmlRequest;
    },
    sendSerializedErrorsToClient: function() {
        return sendSerializedErrorsToClient;
    },
    sendSerializedErrorsToClientForHtmlRequest: function() {
        return sendSerializedErrorsToClientForHtmlRequest;
    },
    setErrorsRscStreamForHtmlRequest: function() {
        return setErrorsRscStreamForHtmlRequest;
    }
});
const _nodewebstreamshelper = require("../stream-utils/node-web-streams-helper");
const _hotreloadertypes = require("./hot-reloader-types");
const errorsRscStreamsByHtmlRequestId = new Map();
function sendSerializedErrorsToClient(errorsRscStream, sendToClient) {
    (0, _nodewebstreamshelper.streamToUint8Array)(errorsRscStream).then((serializedErrors)=>{
        sendToClient({
            type: _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.ERRORS_TO_SHOW_IN_BROWSER,
            serializedErrors
        });
    }, (err)=>{
        console.error(Object.defineProperty(new Error('Failed to serialize errors.', {
            cause: err
        }), "__NEXT_ERROR_CODE", {
            value: "E948",
            enumerable: false,
            configurable: true
        }));
    });
}
function sendSerializedErrorsToClientForHtmlRequest(htmlRequestId, sendToClient) {
    const errorsRscStream = errorsRscStreamsByHtmlRequestId.get(htmlRequestId);
    if (!errorsRscStream) {
        return;
    }
    errorsRscStreamsByHtmlRequestId.delete(htmlRequestId);
    sendSerializedErrorsToClient(errorsRscStream, sendToClient);
}
function setErrorsRscStreamForHtmlRequest(htmlRequestId, errorsRscStream) {
    // TODO: Clean up after a timeout, in case the client never connects, e.g.
    // when CURL'ing the page, or loading the page with JavaScript disabled etc.
    errorsRscStreamsByHtmlRequestId.set(htmlRequestId, errorsRscStream);
}
function deleteErrorsRscStreamForHtmlRequest(htmlRequestId) {
    errorsRscStreamsByHtmlRequestId.delete(htmlRequestId);
}

//# sourceMappingURL=serialized-errors.js.map