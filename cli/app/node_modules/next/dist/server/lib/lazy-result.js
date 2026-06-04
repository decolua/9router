"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    createLazyResult: null,
    isResolvedLazyResult: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    createLazyResult: function() {
        return createLazyResult;
    },
    isResolvedLazyResult: function() {
        return isResolvedLazyResult;
    }
});
function createLazyResult(fn) {
    let pendingResult;
    const result = {
        then (onfulfilled, onrejected) {
            if (!pendingResult) {
                pendingResult = Promise.resolve(fn());
            }
            pendingResult.then((value)=>{
                result.value = value;
            }).catch(()=>{
            // The externally awaited result will be rejected via `onrejected`. We
            // don't need to handle it here. But we do want to avoid an unhandled
            // rejection.
            });
            return pendingResult.then(onfulfilled, onrejected);
        }
    };
    return result;
}
function isResolvedLazyResult(result) {
    return result.hasOwnProperty('value');
}

//# sourceMappingURL=lazy-result.js.map