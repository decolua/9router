"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "createIncrementalCache", {
    enumerable: true,
    get: function() {
        return createIncrementalCache;
    }
});
const _path = /*#__PURE__*/ _interop_require_default(require("path"));
const _incrementalcache = require("../../server/lib/incremental-cache");
const _ciinfo = require("../../server/ci-info");
const _nodefsmethods = require("../../server/lib/node-fs-methods");
const _interopdefault = require("../../lib/interop-default");
const _formatdynamicimportpath = require("../../lib/format-dynamic-import-path");
const _handlers = require("../../server/use-cache/handlers");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
async function createIncrementalCache({ cacheHandler, cacheMaxMemorySize, fetchCacheKeyPrefix, distDir, dir, flushToDisk, cacheHandlers, requestHeaders }) {
    // Custom cache handler overrides.
    let CacheHandler;
    if (cacheHandler) {
        CacheHandler = (0, _interopdefault.interopDefault)(await import((0, _formatdynamicimportpath.formatDynamicImportPath)(dir, cacheHandler)).then((mod)=>mod.default || mod));
    }
    if (cacheHandlers && (0, _handlers.initializeCacheHandlers)(cacheMaxMemorySize)) {
        for (const [kind, handler] of Object.entries(cacheHandlers)){
            if (!handler) continue;
            (0, _handlers.setCacheHandler)(kind, (0, _interopdefault.interopDefault)(await import((0, _formatdynamicimportpath.formatDynamicImportPath)(dir, handler)).then((mod)=>mod.default || mod)));
        }
    }
    const incrementalCache = new _incrementalcache.IncrementalCache({
        dev: false,
        requestHeaders: requestHeaders || {},
        flushToDisk,
        maxMemoryCacheSize: cacheMaxMemorySize,
        fetchCacheKeyPrefix,
        getPrerenderManifest: ()=>({
                version: 4,
                routes: {},
                dynamicRoutes: {},
                preview: {
                    previewModeEncryptionKey: '',
                    previewModeId: '',
                    previewModeSigningKey: ''
                },
                notFoundRoutes: []
            }),
        fs: _nodefsmethods.nodeFs,
        serverDistDir: _path.default.join(distDir, 'server'),
        CurCacheHandler: CacheHandler,
        minimalMode: _ciinfo.hasNextSupport
    });
    globalThis.__incrementalCache = incrementalCache;
    return incrementalCache;
}

//# sourceMappingURL=create-incremental-cache.js.map