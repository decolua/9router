"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    edgeConditionName: null,
    getMainField: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    edgeConditionName: function() {
        return edgeConditionName;
    },
    getMainField: function() {
        return getMainField;
    }
});
const _constants = require("../../shared/lib/constants");
const edgeConditionName = 'edge-light';
const mainFieldsPerCompiler = {
    // For default case, prefer CJS over ESM on server side. e.g. pages dir SSR
    [_constants.COMPILER_NAMES.server]: [
        'main',
        'module'
    ],
    [_constants.COMPILER_NAMES.client]: [
        'browser',
        'module',
        'main'
    ],
    // For bundling-all strategy, prefer ESM over CJS
    'server-esm': [
        'module',
        'main'
    ]
};
function getMainField(compilerType, preferEsm) {
    if (compilerType === _constants.COMPILER_NAMES.edgeServer) {
        return [
            'edge-light',
            '...'
        ];
    } else if (compilerType === _constants.COMPILER_NAMES.client) {
        return mainFieldsPerCompiler[_constants.COMPILER_NAMES.client];
    }
    // Prefer module fields over main fields for isomorphic packages on server layer
    return preferEsm ? mainFieldsPerCompiler['server-esm'] : mainFieldsPerCompiler[_constants.COMPILER_NAMES.server];
}

//# sourceMappingURL=resolve.js.map