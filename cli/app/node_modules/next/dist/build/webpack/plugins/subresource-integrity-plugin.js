"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "SubresourceIntegrityPlugin", {
    enumerable: true,
    get: function() {
        return SubresourceIntegrityPlugin;
    }
});
const _webpack = require("next/dist/compiled/webpack/webpack");
const _crypto = /*#__PURE__*/ _interop_require_default(require("crypto"));
const _constants = require("../../../shared/lib/constants");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
const PLUGIN_NAME = 'SubresourceIntegrityPlugin';
class SubresourceIntegrityPlugin {
    constructor(algorithm){
        this.algorithm = algorithm;
    }
    apply(compiler) {
        compiler.hooks.make.tap(PLUGIN_NAME, (compilation)=>{
            compilation.hooks.afterProcessAssets.tap({
                name: PLUGIN_NAME,
                stage: _webpack.webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONS
            }, ()=>{
                // Collect all the assets.
                let files = new Set();
                for (const asset of compilation.getAssets()){
                    files.add(asset.name);
                }
                // For each file, deduped, calculate the file hash.
                const hashes = {};
                for (const file of files.values()){
                    // Get the buffer for the asset.
                    const asset = compilation.getAsset(file);
                    if (!asset) {
                        throw Object.defineProperty(new Error(`could not get asset: ${file}`), "__NEXT_ERROR_CODE", {
                            value: "E349",
                            enumerable: false,
                            configurable: true
                        });
                    }
                    // Get the buffer for the asset.
                    const buffer = asset.source.buffer();
                    // Create the hash for the content.
                    const hash = _crypto.default.createHash(this.algorithm).update(buffer).digest().toString('base64');
                    hashes[file] = `${this.algorithm}-${hash}`;
                }
                const json = JSON.stringify(hashes, null, 2);
                const file = 'server/' + _constants.SUBRESOURCE_INTEGRITY_MANIFEST;
                compilation.emitAsset(file + '.js', new _webpack.sources.RawSource(`self.__SUBRESOURCE_INTEGRITY_MANIFEST=${JSON.stringify(json)}`));
                compilation.emitAsset(file + '.json', new _webpack.sources.RawSource(json));
            });
        });
    }
}

//# sourceMappingURL=subresource-integrity-plugin.js.map