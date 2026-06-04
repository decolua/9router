"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    getDevTypesPath: null,
    getTypeDefinitionGlobPatterns: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    getDevTypesPath: function() {
        return getDevTypesPath;
    },
    getTypeDefinitionGlobPatterns: function() {
        return getTypeDefinitionGlobPatterns;
    }
});
const _path = /*#__PURE__*/ _interop_require_default(require("path"));
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
function getTypeDefinitionGlobPatterns(distDir) {
    const distDirPosix = _path.default.win32.sep === _path.default.sep ? distDir.replaceAll(_path.default.win32.sep, _path.default.posix.sep) : distDir;
    const typeGlobPatterns = [
        `${distDirPosix}/types/**/*.ts`
    ];
    // Include both .next/types and .next/dev/types to avoid tsconfig churn when switching
    // between dev/build modes
    typeGlobPatterns.push(process.env.NODE_ENV === 'development' ? `${distDirPosix.replace(/\/dev$/, '')}/types/**/*.ts` : `${distDirPosix}/dev/types/**/*.ts`);
    // Sort for consistent order
    typeGlobPatterns.sort((a, b)=>a.length - b.length);
    return typeGlobPatterns;
}
function getDevTypesPath(baseDir, distDir) {
    const isDev = process.env.NODE_ENV === 'development';
    if (isDev) {
        // In dev mode, dev types are the main types, so no need to filter
        return null;
    }
    // In build mode, dev types are at "{baseDir}/{distDir}/dev/types" and should be filtered
    return _path.default.join(baseDir, distDir, 'dev', 'types');
}

//# sourceMappingURL=type-paths.js.map