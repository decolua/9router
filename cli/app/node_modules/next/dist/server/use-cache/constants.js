"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    DYNAMIC_EXPIRE: null,
    RUNTIME_PREFETCH_DYNAMIC_STALE: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    DYNAMIC_EXPIRE: function() {
        return DYNAMIC_EXPIRE;
    },
    RUNTIME_PREFETCH_DYNAMIC_STALE: function() {
        return RUNTIME_PREFETCH_DYNAMIC_STALE;
    }
});
const DYNAMIC_EXPIRE = 300 // 5 minutes
;
const RUNTIME_PREFETCH_DYNAMIC_STALE = 30 // 30 seconds
;

//# sourceMappingURL=constants.js.map