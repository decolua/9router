"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "getTracedMetadata", {
    enumerable: true,
    get: function() {
        return getTracedMetadata;
    }
});
function getTracedMetadata(traceData, clientTraceMetadata) {
    if (!clientTraceMetadata) return undefined;
    return traceData.filter(({ key })=>clientTraceMetadata.includes(key));
}

//# sourceMappingURL=utils.js.map