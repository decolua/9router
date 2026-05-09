"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    getMaxPostponedStateSize: null,
    getPostponedStateExceededErrorMessage: null,
    readBodyWithSizeLimit: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    getMaxPostponedStateSize: function() {
        return getMaxPostponedStateSize;
    },
    getPostponedStateExceededErrorMessage: function() {
        return getPostponedStateExceededErrorMessage;
    },
    readBodyWithSizeLimit: function() {
        return readBodyWithSizeLimit;
    }
});
const _sizelimit = require("../../shared/lib/size-limit");
const INVALID_MAX_POSTPONED_STATE_SIZE_ERROR_MESSAGE = 'maxPostponedStateSize must be a valid number (bytes) or filesize format string (e.g., "5mb")';
function getMaxPostponedStateSize(configuredMaxPostponedStateSize) {
    const maxPostponedStateSize = configuredMaxPostponedStateSize ?? _sizelimit.DEFAULT_MAX_POSTPONED_STATE_SIZE;
    const maxPostponedStateSizeBytes = (0, _sizelimit.parseMaxPostponedStateSize)(configuredMaxPostponedStateSize);
    if (maxPostponedStateSizeBytes === undefined) {
        throw Object.defineProperty(new Error(INVALID_MAX_POSTPONED_STATE_SIZE_ERROR_MESSAGE), "__NEXT_ERROR_CODE", {
            value: "E977",
            enumerable: false,
            configurable: true
        });
    }
    return {
        maxPostponedStateSize,
        maxPostponedStateSizeBytes
    };
}
function getPostponedStateExceededErrorMessage(maxPostponedStateSize) {
    return `Postponed state exceeded ${maxPostponedStateSize} limit. ` + `To configure the limit, see: https://nextjs.org/docs/app/api-reference/config/next-config-js/max-postponed-state-size`;
}
function toBuffer(chunk) {
    return Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
}
async function readBodyWithSizeLimit(body, maxBodySizeBytes) {
    const chunks = [];
    let size = 0;
    for await (const chunk of body){
        const buffer = toBuffer(chunk);
        size += buffer.byteLength;
        if (size > maxBodySizeBytes) {
            return null;
        }
        chunks.push(buffer);
    }
    return Buffer.concat(chunks);
}

//# sourceMappingURL=postponed-request-body.js.map