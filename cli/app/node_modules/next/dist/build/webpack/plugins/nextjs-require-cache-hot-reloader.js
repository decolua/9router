"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "NextJsRequireCacheHotReloader", {
    enumerable: true,
    get: function() {
        return NextJsRequireCacheHotReloader;
    }
});
const _requirecache = require("../../../server/dev/require-cache");
const _sandbox = require("../../../server/web/sandbox");
const _path = /*#__PURE__*/ _interop_require_default(require("path"));
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
const RUNTIME_NAMES = [
    'webpack-runtime',
    'webpack-api-runtime'
];
const PLUGIN_NAME = 'NextJsRequireCacheHotReloader';
class NextJsRequireCacheHotReloader {
    constructor(opts){
        this.prevAssets = null;
        this.serverComponents = opts.serverComponents;
    }
    apply(compiler) {
        compiler.hooks.assetEmitted.tap(PLUGIN_NAME, (_file, { targetPath })=>{
            // Clear module context in this process
            (0, _sandbox.clearModuleContext)(targetPath);
            (0, _requirecache.deleteCache)([
                targetPath
            ]);
        });
        compiler.hooks.afterEmit.tapPromise(PLUGIN_NAME, async (compilation)=>{
            // we need to make sure to clear all server entries from cache
            // since they can have a stale webpack-runtime cache
            // which needs to always be in-sync
            const outputPath = compilation.outputOptions.path;
            const allPaths = RUNTIME_NAMES.map((name)=>_path.default.join(outputPath, `${name}.js`));
            for (const entry of compilation.entrypoints.keys()){
                if (entry.startsWith('pages/') || entry.startsWith('app/')) {
                    allPaths.push(_path.default.join(outputPath, `${entry}.js`));
                }
            }
            (0, _requirecache.deleteCache)(allPaths);
        });
    }
}

//# sourceMappingURL=nextjs-require-cache-hot-reloader.js.map