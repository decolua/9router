"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    anySegmentHasRuntimePrefetchEnabled: null,
    anySegmentNeedsInstantValidationInBuild: null,
    anySegmentNeedsInstantValidationInDev: null,
    findSegmentsWithInstantConfig: null,
    isPageAllowedToBlock: null,
    resolveInstantConfigSamplesForPage: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    anySegmentHasRuntimePrefetchEnabled: function() {
        return anySegmentHasRuntimePrefetchEnabled;
    },
    anySegmentNeedsInstantValidationInBuild: function() {
        return anySegmentNeedsInstantValidationInBuild;
    },
    anySegmentNeedsInstantValidationInDev: function() {
        return anySegmentNeedsInstantValidationInDev;
    },
    findSegmentsWithInstantConfig: function() {
        return findSegmentsWithInstantConfig;
    },
    isPageAllowedToBlock: function() {
        return isPageAllowedToBlock;
    },
    resolveInstantConfigSamplesForPage: function() {
        return resolveInstantConfigSamplesForPage;
    }
});
const _appdirmodule = require("../../lib/app-dir-module");
const _parseloadertree = require("../../../shared/lib/router/utils/parse-loader-tree");
const _workasyncstorageexternal = require("../work-async-storage.external");
async function anySegmentHasRuntimePrefetchEnabled(tree) {
    const { mod: layoutOrPageMod } = await (0, _appdirmodule.getLayoutOrPageModule)(tree);
    // TODO(restart-on-cache-miss): Does this work correctly for client page/layout modules?
    const instantConfig = layoutOrPageMod ? layoutOrPageMod.unstable_instant : undefined;
    const hasRuntimePrefetch = instantConfig && typeof instantConfig === 'object' ? instantConfig.prefetch === 'runtime' : false;
    if (hasRuntimePrefetch) {
        return true;
    }
    const { parallelRoutes } = (0, _parseloadertree.parseLoaderTree)(tree);
    for(const parallelRouteKey in parallelRoutes){
        const parallelRoute = parallelRoutes[parallelRouteKey];
        const hasChildRuntimePrefetch = await anySegmentHasRuntimePrefetchEnabled(parallelRoute);
        if (hasChildRuntimePrefetch) {
            return true;
        }
    }
    return false;
}
async function isPageAllowedToBlock(tree) {
    const { mod: layoutOrPageMod } = await (0, _appdirmodule.getLayoutOrPageModule)(tree);
    // TODO(restart-on-cache-miss): Does this work correctly for client page/layout modules?
    const instantConfig = layoutOrPageMod ? layoutOrPageMod.unstable_instant : undefined;
    // If we encounter a non-false instant config before a instant=false,
    // the page isn't allowed to block. The config expresses a requirement for
    // instant UI, so we should make sure that a static shell exists.
    // (even if it'd use runtime prefetching for client navs)
    if (instantConfig !== undefined) {
        if (typeof instantConfig === 'object') {
            return false;
        } else if (instantConfig === false) {
            return true;
        }
    }
    const { parallelRoutes } = (0, _parseloadertree.parseLoaderTree)(tree);
    for(const parallelRouteKey in parallelRoutes){
        const parallelRoute = parallelRoutes[parallelRouteKey];
        const subtreeIsBlocking = await isPageAllowedToBlock(parallelRoute);
        if (subtreeIsBlocking) {
            return true;
        }
    }
    return false;
}
/**
 * Checks if any segments in the loader tree have `instant` configs that need validating.
 * NOTE: Client navigations call this multiple times, so we cache it.
 * */ // Shared helper (not exported, not cached — called by the cached wrappers)
async function anySegmentNeedsInstantValidation(rootTree, mode) {
    const segments = await findSegmentsWithInstantConfig(rootTree);
    // Check if there's any configs with `prefetch: 'static'` or `mode: 'instant'`.
    // (If there's only `false`, there's no need to run validation).
    // If any segment has `unstable_disableValidation`, we skip validation for the whole tree.
    let needsValidation = false;
    for (const { config } of segments){
        if (typeof config === 'object') {
            if (config.unstable_disableValidation === true || mode === 'dev' && config.unstable_disableDevValidation === true || mode === 'build' && config.unstable_disableBuildValidation === true) {
                return false;
            }
            // do not short-circuit, some other segment might still have `unstable_disableValidation`
            needsValidation = true;
        }
    }
    return needsValidation;
}
const anySegmentNeedsInstantValidationInDev = cacheScopedToWorkStore(async (rootTree)=>anySegmentNeedsInstantValidation(rootTree, 'dev'));
const anySegmentNeedsInstantValidationInBuild = cacheScopedToWorkStore(async (rootTree)=>anySegmentNeedsInstantValidation(rootTree, 'build'));
const findSegmentsWithInstantConfig = cacheScopedToWorkStore(async (rootTree)=>{
    const results = [];
    async function visit(tree, path) {
        const { mod: layoutOrPageMod } = await (0, _appdirmodule.getLayoutOrPageModule)(tree);
        // TODO(restart-on-cache-miss): Does this work correctly for client page/layout modules?
        const instantConfig = layoutOrPageMod ? layoutOrPageMod.unstable_instant : undefined;
        if (instantConfig !== undefined) {
            results.push({
                path,
                config: instantConfig
            });
        }
        const { parallelRoutes } = (0, _parseloadertree.parseLoaderTree)(tree);
        for(const parallelRouteKey in parallelRoutes){
            const childTree = parallelRoutes[parallelRouteKey];
            await visit(childTree, [
                ...path,
                parallelRouteKey
            ]);
        }
    }
    await visit(rootTree, []);
    return results;
});
const resolveInstantConfigSamplesForPage = async (tree)=>{
    const { mod: layoutOrPageMod } = await (0, _appdirmodule.getLayoutOrPageModule)(tree);
    const instantConfig = layoutOrPageMod ? layoutOrPageMod.unstable_instant : undefined;
    let samples = null;
    if (instantConfig !== undefined && typeof instantConfig === 'object' && instantConfig.samples) {
        samples = instantConfig.samples;
    }
    // The samples from inner segments override samples from outer segments,
    // i.e. a page overrides the samples from a layout.
    // We do not perform any merging logic.
    const { parallelRoutes } = (0, _parseloadertree.parseLoaderTree)(tree);
    for(const parallelRouteKey in parallelRoutes){
        if (parallelRouteKey !== 'children') {
            continue;
        }
        const childTree = parallelRoutes[parallelRouteKey];
        const childSamples = await resolveInstantConfigSamplesForPage(childTree);
        if (childSamples !== null) {
            samples = childSamples;
        }
    }
    return samples;
};
/**
 * A simple cache wrapper for 1-argument functions.
 * The cache will live as long as the current WorkStore,
 * i.e. it's scoped to a single request.
 */ function cacheScopedToWorkStore(func) {
    const resultsPerWorkStore = new WeakMap();
    return (arg)=>{
        const workStore = _workasyncstorageexternal.workAsyncStorage.getStore();
        if (!workStore) {
            // No caching.
            return func(arg);
        }
        let results = resultsPerWorkStore.get(workStore);
        if (results && results.has(arg)) {
            return results.get(arg);
        }
        const result = func(arg);
        if (!results) {
            results = new WeakMap();
            resultsPerWorkStore.set(workStore, results);
        }
        results.set(arg, result);
        return result;
    };
}

//# sourceMappingURL=instant-config.js.map