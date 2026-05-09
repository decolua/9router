"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "DeferredEntriesPlugin", {
    enumerable: true,
    get: function() {
        return DeferredEntriesPlugin;
    }
});
const _webpack = require("next/dist/compiled/webpack/webpack");
const _debug = /*#__PURE__*/ _interop_require_default(require("next/dist/compiled/debug"));
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
const debug = (0, _debug.default)('next:deferred-entries-plugin');
const PLUGIN_NAME = 'DeferredEntriesPlugin';
class DeferredEntriesPlugin {
    constructor(options){
        this.callbackCalled = false;
        this.onBeforeDeferredEntries = options.config.experimental.onBeforeDeferredEntries;
        this.deferredEntrypoints = options.deferredEntrypoints;
    }
    apply(compiler) {
        // Skip if no deferred entrypoints to process
        if (!this.deferredEntrypoints || Object.keys(this.deferredEntrypoints).length === 0) {
            return;
        }
        // Use finishMake hook to add deferred entries after all initial entries are processed
        // This is the same pattern used by FlightClientEntryPlugin
        compiler.hooks.finishMake.tapPromise(PLUGIN_NAME, async (compilation)=>{
            // Only process if we haven't called callback yet
            if (this.callbackCalled) {
                return;
            }
            this.callbackCalled = true;
            // Call the onBeforeDeferredEntries callback
            if (this.onBeforeDeferredEntries) {
                debug('calling onBeforeDeferredEntries callback');
                await this.onBeforeDeferredEntries();
                debug('onBeforeDeferredEntries callback completed');
            }
            // Add deferred entries to compilation
            const addEntryPromises = [];
            const bundler = _webpack.webpack;
            debug('adding deferred entries:', Object.keys(this.deferredEntrypoints));
            for (const [name, entryData] of Object.entries(this.deferredEntrypoints)){
                debug('processing deferred entry:', name, entryData);
                // Normalize entry data structure
                let entry;
                if (typeof entryData === 'string') {
                    entry = {
                        import: [
                            entryData
                        ]
                    };
                } else if (Array.isArray(entryData)) {
                    entry = {
                        import: entryData
                    };
                } else {
                    entry = entryData;
                }
                // Get imports array
                const imports = entry.import ? Array.isArray(entry.import) ? entry.import : [
                    entry.import
                ] : [];
                if (imports.length === 0) {
                    continue;
                }
                // Normalize dependOn to always be an array
                const dependOn = entry.dependOn ? Array.isArray(entry.dependOn) ? entry.dependOn : [
                    entry.dependOn
                ] : undefined;
                // Create dependencies for all imports
                for (const importPath of imports){
                    if (typeof importPath !== 'string') {
                        continue;
                    }
                    const dep = bundler.EntryPlugin.createDependency(importPath, {
                        name
                    });
                    addEntryPromises.push(new Promise((resolve, reject)=>{
                        compilation.addEntry(compiler.context, dep, {
                            name,
                            layer: entry.layer,
                            runtime: entry.runtime,
                            dependOn
                        }, (err)=>{
                            if (err) {
                                reject(err);
                            } else {
                                resolve();
                            }
                        });
                    }));
                }
            }
            await Promise.all(addEntryPromises);
        });
    }
}

//# sourceMappingURL=deferred-entries-plugin.js.map