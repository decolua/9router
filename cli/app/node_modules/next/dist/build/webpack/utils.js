"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    forEachEntryModule: null,
    formatBarrelOptimizedResource: null,
    getCompilationSpan: null,
    getModuleReferencesInOrder: null,
    traverseModules: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    forEachEntryModule: function() {
        return forEachEntryModule;
    },
    formatBarrelOptimizedResource: function() {
        return formatBarrelOptimizedResource;
    },
    getCompilationSpan: function() {
        return getCompilationSpan;
    },
    getModuleReferencesInOrder: function() {
        return getModuleReferencesInOrder;
    },
    traverseModules: function() {
        return traverseModules;
    }
});
const _entries = require("../entries");
const _profilingplugin = require("./plugins/profiling-plugin");
const _rspackprofilingplugin = require("./plugins/rspack-profiling-plugin");
function traverseModules(compilation, callback, filterChunkGroup) {
    compilation.chunkGroups.forEach((chunkGroup)=>{
        if (filterChunkGroup && !filterChunkGroup(chunkGroup)) {
            return;
        }
        chunkGroup.chunks.forEach((chunk)=>{
            const chunkModules = compilation.chunkGraph.getChunkModulesIterable(chunk);
            for (const mod of chunkModules){
                var _compilation_chunkGraph_getModuleId;
                const modId = (_compilation_chunkGraph_getModuleId = compilation.chunkGraph.getModuleId(mod)) == null ? void 0 : _compilation_chunkGraph_getModuleId.toString();
                if (modId) callback(mod, chunk, chunkGroup, modId);
                const anyModule = mod;
                if (anyModule.modules) {
                    for (const subMod of anyModule.modules)if (modId) callback(subMod, chunk, chunkGroup, modId);
                }
            }
        });
    });
}
function forEachEntryModule(compilation, callback) {
    for (const [name, entry] of compilation.entries.entries()){
        var _entry_dependencies;
        // Skip for entries under pages/
        if (name.startsWith('pages/')) {
            continue;
        }
        // Check if the page entry is a server component or not.
        const entryDependency = (_entry_dependencies = entry.dependencies) == null ? void 0 : _entry_dependencies[0];
        // Ensure only next-app-loader entries are handled.
        if (!entryDependency || !entryDependency.request) continue;
        const request = entryDependency.request;
        if (!request.startsWith('next-edge-ssr-loader?') && !request.startsWith('next-edge-app-route-loader?') && !request.startsWith(`${(0, _entries.getAppLoader)()}?`)) continue;
        let entryModule = compilation.moduleGraph.getResolvedModule(entryDependency);
        if (request.startsWith('next-edge-ssr-loader?') || request.startsWith('next-edge-app-route-loader?')) {
            entryModule.dependencies.forEach((dependency)=>{
                const modRequest = dependency.request;
                if (modRequest == null ? void 0 : modRequest.includes((0, _entries.getAppLoader)())) {
                    entryModule = compilation.moduleGraph.getResolvedModule(dependency);
                }
            });
        }
        callback({
            name,
            entryModule
        });
    }
}
function formatBarrelOptimizedResource(resource, matchResource) {
    return `${resource}@${matchResource}`;
}
function getModuleReferencesInOrder(module1, moduleGraph) {
    if ('getOutgoingConnectionsInOrder' in moduleGraph && typeof moduleGraph.getOutgoingConnectionsInOrder === 'function') {
        return moduleGraph.getOutgoingConnectionsInOrder(module1);
    }
    const connections = [];
    for (const connection of moduleGraph.getOutgoingConnections(module1)){
        if (connection.dependency && connection.module) {
            connections.push({
                connection,
                index: moduleGraph.getParentBlockIndex(connection.dependency)
            });
        }
    }
    connections.sort((a, b)=>a.index - b.index);
    return connections.map((c)=>c.connection);
}
function getCompilationSpan(compilation) {
    const compilationSpans = process.env.NEXT_RSPACK ? _rspackprofilingplugin.compilationSpans : _profilingplugin.spans;
    return compilationSpans.get(compilation);
}

//# sourceMappingURL=utils.js.map