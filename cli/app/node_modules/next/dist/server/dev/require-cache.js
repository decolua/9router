"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "deleteCache", {
    enumerable: true,
    get: function() {
        return deleteCache;
    }
});
const _iserror = /*#__PURE__*/ _interop_require_default(require("../../lib/is-error"));
const _realpath = require("../../lib/realpath");
const _loadmanifestexternal = require("../load-manifest.external");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
/**
 * Batch delete modules from require.cache with a single scan.
 *
 * When deleting N modules, this performs ONE scan of require.cache
 * instead of N scans, reducing complexity from O(N * C) to O(C + N)
 * where C = size of require.cache.
 */ function deleteFromRequireCache(filePaths) {
    // Phase 1: Resolve all paths and collect modules to delete
    const resolvedPaths = [];
    const modsToDelete = new Set();
    for (let filePath of filePaths){
        try {
            filePath = (0, _realpath.realpathSync)(filePath);
        } catch (e) {
            if ((0, _iserror.default)(e) && e.code !== 'ENOENT') throw e;
        }
        const mod = require.cache[filePath];
        if (mod) {
            resolvedPaths.push(filePath);
            modsToDelete.add(mod);
        }
    }
    if (modsToDelete.size === 0) return;
    // Phase 2: Single scan of require.cache to remove child references
    const modules = Object.values(require.cache);
    for(let m = 0; m < modules.length; m++){
        var _modules_m;
        const children = (_modules_m = modules[m]) == null ? void 0 : _modules_m.children;
        if (children && children.length) {
            let len = children.length;
            for(let i = 0; i < len; i++){
                if (modsToDelete.has(children[i])) {
                    children[i] = children[--len];
                    i-- // re-check swapped element
                    ;
                }
            }
            children.length = len;
        }
    }
    // Phase 3: Clear parent references from children and delete cache entries
    for (const mod of modsToDelete){
        const children = mod.children;
        for(let i = 0; i < children.length; i++){
            if (children[i].parent === mod) {
                children[i].parent = null;
            }
        }
    }
    for (const filePath of resolvedPaths){
        delete require.cache[filePath];
    }
}
function deleteCache(filePaths) {
    for (const filePath of filePaths){
        (0, _loadmanifestexternal.clearManifestCache)(filePath);
    }
    deleteFromRequireCache(filePaths);
}

//# sourceMappingURL=require-cache.js.map