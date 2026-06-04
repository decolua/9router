"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    createEdgeRuntimeManifest: null,
    normalizeRewritesForBuildManifest: null,
    processRoute: null,
    srcEmptySsgManifest: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    createEdgeRuntimeManifest: function() {
        return createEdgeRuntimeManifest;
    },
    normalizeRewritesForBuildManifest: function() {
        return normalizeRewritesForBuildManifest;
    },
    processRoute: function() {
        return processRoute;
    },
    srcEmptySsgManifest: function() {
        return srcEmptySsgManifest;
    }
});
const srcEmptySsgManifest = `self.__SSG_MANIFEST=new Set;self.__SSG_MANIFEST_CB&&self.__SSG_MANIFEST_CB()`;
function normalizeRewrite(item) {
    return {
        has: item.has,
        source: item.source,
        destination: item.destination
    };
}
const processRoute = (r)=>{
    var _rewrite_destination;
    const rewrite = {
        ...r
    };
    // omit external rewrite destinations since these aren't
    // handled client-side
    if (!(rewrite == null ? void 0 : (_rewrite_destination = rewrite.destination) == null ? void 0 : _rewrite_destination.startsWith('/'))) {
        delete rewrite.destination;
    }
    return rewrite;
};
function normalizeRewritesForBuildManifest(rewrites) {
    var _rewrites_afterFiles_map, _rewrites_afterFiles, _rewrites_beforeFiles_map, _rewrites_beforeFiles, _rewrites_fallback_map, _rewrites_fallback;
    return {
        afterFiles: (_rewrites_afterFiles = rewrites.afterFiles) == null ? void 0 : (_rewrites_afterFiles_map = _rewrites_afterFiles.map(processRoute)) == null ? void 0 : _rewrites_afterFiles_map.map((item)=>normalizeRewrite(item)),
        beforeFiles: (_rewrites_beforeFiles = rewrites.beforeFiles) == null ? void 0 : (_rewrites_beforeFiles_map = _rewrites_beforeFiles.map(processRoute)) == null ? void 0 : _rewrites_beforeFiles_map.map((item)=>normalizeRewrite(item)),
        fallback: (_rewrites_fallback = rewrites.fallback) == null ? void 0 : (_rewrites_fallback_map = _rewrites_fallback.map(processRoute)) == null ? void 0 : _rewrites_fallback_map.map((item)=>normalizeRewrite(item))
    };
}
function createEdgeRuntimeManifest(assetMap) {
    // we use globalThis here because middleware can be node
    // which doesn't have "self"
    return `globalThis.__BUILD_MANIFEST = ${JSON.stringify(assetMap, null, 2)};\n`;
}

//# sourceMappingURL=build-manifest-plugin-utils.js.map