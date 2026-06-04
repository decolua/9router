"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    expectCompleteParamsInClientValidation: null,
    instrumentParamsForClientValidation: null,
    instrumentSearchParamsForClientValidation: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    expectCompleteParamsInClientValidation: function() {
        return expectCompleteParamsInClientValidation;
    },
    instrumentParamsForClientValidation: function() {
        return instrumentParamsForClientValidation;
    },
    instrumentSearchParamsForClientValidation: function() {
        return instrumentSearchParamsForClientValidation;
    }
});
const _workunitasyncstorageexternal = require("../work-unit-async-storage.external");
const _workasyncstorageexternal = require("../work-async-storage.external");
const _instantsamples = require("./instant-samples");
const _instantvalidationerror = require("./instant-validation-error");
function instrumentParamsForClientValidation(underlyingParams) {
    const workStore = _workasyncstorageexternal.workAsyncStorage.getStore();
    const workUnitStore = _workunitasyncstorageexternal.workUnitAsyncStorage.getStore();
    if (workStore && workUnitStore) {
        switch(workUnitStore.type){
            case 'validation-client':
                {
                    if (workUnitStore.validationSamples) {
                        const declaredKeys = new Set(Object.keys(workUnitStore.validationSamples.params ?? {}));
                        return (0, _instantsamples.createExhaustiveParamsProxy)(underlyingParams, declaredKeys, workStore.route);
                    }
                    break;
                }
            case 'prerender-runtime':
            case 'prerender-client':
            case 'prerender-legacy':
            case 'prerender-ppr':
            case 'prerender':
            case 'cache':
            case 'request':
            case 'private-cache':
            case 'unstable-cache':
            case 'generate-static-params':
                break;
            default:
                workUnitStore;
        }
    }
    return underlyingParams;
}
function expectCompleteParamsInClientValidation(expression) {
    const workStore = _workasyncstorageexternal.workAsyncStorage.getStore();
    const workUnitStore = _workunitasyncstorageexternal.workUnitAsyncStorage.getStore();
    if (workStore && workUnitStore) {
        switch(workUnitStore.type){
            case 'validation-client':
                {
                    if (workUnitStore.validationSamples) {
                        const fallbackParams = workUnitStore.fallbackRouteParams;
                        if (fallbackParams && fallbackParams.size > 0) {
                            const missingParams = Array.from(fallbackParams.keys());
                            (0, _instantsamples.trackMissingSampleErrorAndThrow)(Object.defineProperty(new _instantvalidationerror.InstantValidationError(`Route "${workStore.route}" called ${expression} but param${missingParams.length > 1 ? 's' : ''} ${missingParams.map((p)=>`"${p}"`).join(', ')} ${missingParams.length > 1 ? 'are' : 'is'} not defined in the \`samples\` of \`unstable_instant\`. ` + `${expression} requires all route params to be provided.`), "__NEXT_ERROR_CODE", {
                                value: "E1109",
                                enumerable: false,
                                configurable: true
                            }));
                        }
                    }
                    break;
                }
            case 'prerender-runtime':
            case 'prerender-client':
            case 'prerender-legacy':
            case 'prerender-ppr':
            case 'prerender':
            case 'cache':
            case 'request':
            case 'private-cache':
            case 'unstable-cache':
            case 'generate-static-params':
                break;
            default:
                workUnitStore;
        }
    }
}
function instrumentSearchParamsForClientValidation(underlyingSearchParams) {
    const workStore = _workasyncstorageexternal.workAsyncStorage.getStore();
    const workUnitStore = _workunitasyncstorageexternal.workUnitAsyncStorage.getStore();
    if (workStore && workUnitStore) {
        switch(workUnitStore.type){
            case 'validation-client':
                {
                    if (workUnitStore.validationSamples) {
                        const declaredKeys = new Set(Object.keys(workUnitStore.validationSamples.searchParams ?? {}));
                        return (0, _instantsamples.createExhaustiveURLSearchParamsProxy)(underlyingSearchParams, declaredKeys, workStore.route);
                    }
                    break;
                }
            case 'prerender-runtime':
            case 'prerender-client':
            case 'prerender-legacy':
            case 'prerender-ppr':
            case 'prerender':
            case 'cache':
            case 'request':
            case 'private-cache':
            case 'unstable-cache':
            case 'generate-static-params':
                break;
            default:
                workUnitStore;
        }
    }
    return underlyingSearchParams;
}

//# sourceMappingURL=instant-samples-client.js.map