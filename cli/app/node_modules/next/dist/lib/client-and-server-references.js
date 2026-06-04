"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    getUseCacheFunctionInfo: null,
    isClientReference: null,
    isServerReference: null,
    isUseCacheFunction: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    getUseCacheFunctionInfo: function() {
        return getUseCacheFunctionInfo;
    },
    isClientReference: function() {
        return isClientReference;
    },
    isServerReference: function() {
        return isServerReference;
    },
    isUseCacheFunction: function() {
        return isUseCacheFunction;
    }
});
const _serverreferenceinfo = require("../shared/lib/server-reference-info");
function isServerReference(value) {
    return value.$$typeof === Symbol.for('react.server.reference');
}
function isUseCacheFunction(value) {
    if (!isServerReference(value)) {
        return false;
    }
    const { type } = (0, _serverreferenceinfo.extractInfoFromServerReferenceId)(value.$$id);
    return type === 'use-cache';
}
function getUseCacheFunctionInfo(value) {
    if (!isServerReference(value)) {
        return null;
    }
    const info = (0, _serverreferenceinfo.extractInfoFromServerReferenceId)(value.$$id);
    return info.type === 'use-cache' ? info : null;
}
function isClientReference(mod) {
    const defaultExport = (mod == null ? void 0 : mod.default) || mod;
    return (defaultExport == null ? void 0 : defaultExport.$$typeof) === Symbol.for('react.client.reference');
}

//# sourceMappingURL=client-and-server-references.js.map