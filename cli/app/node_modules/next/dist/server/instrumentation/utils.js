"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "getRevalidateReason", {
    enumerable: true,
    get: function() {
        return getRevalidateReason;
    }
});
function getRevalidateReason(params) {
    if (params.isOnDemandRevalidate) {
        return 'on-demand';
    }
    if (params.isStaticGeneration) {
        return 'stale';
    }
    return undefined;
}

//# sourceMappingURL=utils.js.map