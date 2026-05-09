"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    FAST_REFRESH_RUNTIME_RELOAD: null,
    createBinaryHmrMessageData: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    FAST_REFRESH_RUNTIME_RELOAD: function() {
        return FAST_REFRESH_RUNTIME_RELOAD;
    },
    createBinaryHmrMessageData: function() {
        return createBinaryHmrMessageData;
    }
});
const _invarianterror = require("../../shared/lib/invariant-error");
const _hotreloadertypes = require("./hot-reloader-types");
const FAST_REFRESH_RUNTIME_RELOAD = 'Fast Refresh had to perform a full reload due to a runtime error.';
const textEncoder = new TextEncoder();
function createBinaryHmrMessageData(message) {
    switch(message.type){
        case _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.ERRORS_TO_SHOW_IN_BROWSER:
            {
                const { serializedErrors } = message;
                const totalLength = 1 + serializedErrors.length;
                const data = new Uint8Array(totalLength);
                const view = new DataView(data.buffer);
                view.setUint8(0, _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.ERRORS_TO_SHOW_IN_BROWSER);
                data.set(serializedErrors, 1);
                return data;
            }
        case _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.REACT_DEBUG_CHUNK:
            {
                const { requestId, chunk } = message;
                const requestIdBytes = textEncoder.encode(requestId);
                const requestIdLength = requestIdBytes.length;
                if (requestIdLength > 255) {
                    throw Object.defineProperty(new _invarianterror.InvariantError('Request ID is too long for the binary HMR message.'), "__NEXT_ERROR_CODE", {
                        value: "E805",
                        enumerable: false,
                        configurable: true
                    });
                }
                const chunkLength = chunk ? chunk.length : 0;
                const totalLength = 2 + requestIdLength + chunkLength;
                const data = new Uint8Array(totalLength);
                const view = new DataView(data.buffer);
                view.setUint8(0, _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.REACT_DEBUG_CHUNK);
                view.setUint8(1, requestIdLength);
                textEncoder.encodeInto(requestId, data.subarray(2, 2 + requestIdLength));
                if (chunk) {
                    data.set(chunk, 2 + requestIdLength);
                }
                return data;
            }
        default:
            {
                throw Object.defineProperty(new _invarianterror.InvariantError(`Invalid binary HMR message of type ${message.type}`), "__NEXT_ERROR_CODE", {
                    value: "E809",
                    enumerable: false,
                    configurable: true
                });
            }
    }
}

//# sourceMappingURL=messages.js.map