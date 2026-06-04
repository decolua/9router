"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "findHeadInCache", {
    enumerable: true,
    get: function() {
        return findHeadInCache;
    }
});
const _segment = require("../../../../shared/lib/segment");
const _createroutercachekey = require("../create-router-cache-key");
function findHeadInCache(cache, parallelRoutes) {
    return findHeadInCacheImpl(cache, parallelRoutes, '', '');
}
function findHeadInCacheImpl(cache, parallelRoutes, keyPrefix, keyPrefixWithoutSearchParams) {
    const isLastItem = Object.keys(parallelRoutes).length === 0;
    if (isLastItem) {
        // Returns the entire Cache Node of the segment whose head we will render.
        return [
            cache,
            keyPrefix,
            keyPrefixWithoutSearchParams
        ];
    }
    // First try the 'children' parallel route if it exists
    // when starting from the "root", this corresponds with the main page component
    const parallelRoutesKeys = Object.keys(parallelRoutes).filter((key)=>key !== 'children');
    // if we are at the root, we need to check the children slot first
    if ('children' in parallelRoutes) {
        parallelRoutesKeys.unshift('children');
    }
    const slots = cache.slots;
    if (slots !== null) {
        for (const key of parallelRoutesKeys){
            const [segment, childParallelRoutes] = parallelRoutes[key];
            // If the parallel is not matched and using the default segment,
            // skip searching the head from it.
            if (segment === _segment.DEFAULT_SEGMENT_KEY) {
                continue;
            }
            const childCacheNode = slots[key];
            if (!childCacheNode) {
                continue;
            }
            const cacheKey = (0, _createroutercachekey.createRouterCacheKey)(segment);
            const cacheKeyWithoutSearchParams = (0, _createroutercachekey.createRouterCacheKey)(segment, true);
            const item = findHeadInCacheImpl(childCacheNode, childParallelRoutes, keyPrefix + '/' + cacheKey, keyPrefix + '/' + cacheKeyWithoutSearchParams);
            if (item) {
                return item;
            }
        }
    }
    return null;
}

if ((typeof exports.default === 'function' || (typeof exports.default === 'object' && exports.default !== null)) && typeof exports.default.__esModule === 'undefined') {
  Object.defineProperty(exports.default, '__esModule', { value: true });
  Object.assign(exports.default, exports);
  module.exports = exports.default;
}

//# sourceMappingURL=find-head-in-cache.js.map