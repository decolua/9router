"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    assignStaticShellMetadata: null,
    buildAppStaticPaths: null,
    calculateFallbackMode: null,
    filterUniqueParams: null,
    generateAllParamCombinations: null,
    generateRouteStaticParams: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    assignStaticShellMetadata: function() {
        return assignStaticShellMetadata;
    },
    buildAppStaticPaths: function() {
        return buildAppStaticPaths;
    },
    calculateFallbackMode: function() {
        return calculateFallbackMode;
    },
    filterUniqueParams: function() {
        return filterUniqueParams;
    },
    generateAllParamCombinations: function() {
        return generateAllParamCombinations;
    },
    generateRouteStaticParams: function() {
        return generateRouteStaticParams;
    }
});
const _nodepath = /*#__PURE__*/ _interop_require_default(require("node:path"));
const _runwithafter = require("../../server/after/run-with-after");
const _workstore = require("../../server/async-storage/work-store");
const _fallback = require("../../lib/fallback");
const _utils = require("./utils");
const _escapepathdelimiters = /*#__PURE__*/ _interop_require_default(require("../../shared/lib/router/utils/escape-path-delimiters"));
const _createincrementalcache = require("../../export/helpers/create-incremental-cache");
const _getsegmentparam = require("../../shared/lib/router/utils/get-segment-param");
const _emptygeneratestaticparamserror = require("../../shared/lib/errors/empty-generate-static-params-error");
const _interceptionprefixfromparamtype = require("../../shared/lib/router/utils/interception-prefix-from-param-type");
const _implicittags = require("../../server/lib/implicit-tags");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
function filterUniqueParams(childrenRouteParams, routeParams) {
    // A Map is used to store unique parameter combinations. The key of the Map
    // is a string representation of the parameter combination, and the value
    // is the actual `Params` object.
    const unique = new Map();
    // Iterate over each parameter object in the input array.
    for (const params of routeParams){
        let key = '' // Initialize an empty string to build the unique key for the current `params` object.
        ;
        // Iterate through the `routeParamKeys` (which are assumed to be sorted).
        // This consistent order is crucial for generating a stable and unique key
        // for each parameter combination.
        for (const { paramName: paramKey } of childrenRouteParams){
            const value = params[paramKey];
            // Construct a part of the key using the parameter key and its value.
            // A type prefix (`A:` for Array, `S:` for String, `U:` for undefined) is added to the value
            // to prevent collisions. For example, `['a', 'b']` and `'a,b'` would
            // otherwise generate the same string representation, leading to incorrect
            // deduplication. This ensures that different types with the same string
            // representation are treated as distinct.
            let valuePart;
            if (Array.isArray(value)) {
                valuePart = `A:${value.join(',')}`;
            } else if (value === undefined) {
                valuePart = `U:undefined`;
            } else {
                valuePart = `S:${value}`;
            }
            key += `${paramKey}:${valuePart}|`;
        }
        // If the generated key is not already in the `unique` Map, it means this
        // parameter combination is unique so far. Add it to the Map.
        if (!unique.has(key)) {
            unique.set(key, params);
        }
    }
    // Convert the Map's values (the unique `Params` objects) back into an array
    // and return it.
    return Array.from(unique.values());
}
function generateAllParamCombinations(childrenRouteParams, routeParams, rootParamKeys) {
    // A Map is used to store unique combinations of Route Parameters.
    // The key of the Map is a string representation of the Route Parameter
    // combination, and the value is the `Params` object containing only
    // the Route Parameters.
    const combinations = new Map();
    // Determine the minimum index where all Root Parameters are included.
    // This optimization ensures we only generate combinations that include
    // a complete set of Root Parameters, preventing invalid Static Shells.
    //
    // For example, if rootParamKeys = ['lang', 'region'] and routeParamKeys = ['lang', 'region', 'slug']:
    // - 'lang' is at index 0, 'region' is at index 1
    // - minIndexForCompleteRootParams = max(0, 1) = 1
    // - We'll only generate combinations starting from index 1 (which includes both lang and region)
    let minIndexForCompleteRootParams = -1;
    if (rootParamKeys.length > 0) {
        // Find the index of the last Root Parameter in routeParamKeys.
        // This tells us the minimum combination length needed to include all Root Parameters.
        for (const rootParamKey of rootParamKeys){
            const index = childrenRouteParams.findIndex((param)=>param.paramName === rootParamKey);
            if (index === -1) {
                // Root Parameter not found in Route Parameters - this shouldn't happen in normal cases
                // but we handle it gracefully by treating it as if there are no Root Parameters.
                // This allows the function to fall back to generating all sub-combinations.
                minIndexForCompleteRootParams = -1;
                break;
            }
            // Track the highest index among all Root Parameters.
            // This ensures all Root Parameters are included in any generated combination.
            minIndexForCompleteRootParams = Math.max(minIndexForCompleteRootParams, index);
        }
    }
    // Iterate over each Static Parameter object in the input array.
    // Each params object represents one potential route combination (e.g., { lang: 'en', region: 'US', slug: 'home' })
    for (const params of routeParams){
        // Generate all possible prefix combinations for this Static Parameter set.
        // For routeParamKeys = ['lang', 'region', 'slug'], we'll generate combinations at:
        // - i=0: { lang: 'en' }
        // - i=1: { lang: 'en', region: 'US' }
        // - i=2: { lang: 'en', region: 'US', slug: 'home' }
        //
        // The iteration order is crucial for generating stable and unique keys
        // for each Route Parameter combination.
        for(let i = 0; i < childrenRouteParams.length; i++){
            // Skip generating combinations that don't include all Root Parameters.
            // This prevents creating invalid Static Shells that are missing required Root Parameters.
            //
            // For example, if Root Parameters are ['lang', 'region'] and minIndexForCompleteRootParams = 1:
            // - Skip i=0 (would only include 'lang', missing 'region')
            // - Process i=1 and higher (includes both 'lang' and 'region')
            if (minIndexForCompleteRootParams >= 0 && i < minIndexForCompleteRootParams) {
                continue;
            }
            // Initialize data structures for building this specific combination
            const combination = {};
            const keyParts = [];
            let hasAllRootParams = true;
            // Build the sub-combination with parameters from index 0 to i (inclusive).
            // This creates a prefix of the full parameter set, building up combinations incrementally.
            //
            // For example, if routeParamKeys = ['lang', 'region', 'slug'] and i = 1:
            // - j=0: Add 'lang' parameter
            // - j=1: Add 'region' parameter
            // Result: { lang: 'en', region: 'US' }
            for(let j = 0; j <= i; j++){
                const { paramName: routeKey } = childrenRouteParams[j];
                // Check if the parameter exists in the original params object and has a defined value.
                // This handles cases where generateStaticParams doesn't provide all possible parameters,
                // or where some parameters are optional/undefined.
                if (!params.hasOwnProperty(routeKey) || params[routeKey] === undefined) {
                    // If this missing parameter is a Root Parameter, mark the combination as invalid.
                    // Root Parameters are required for Static Shells, so we can't generate partial combinations without them.
                    if (rootParamKeys.includes(routeKey)) {
                        hasAllRootParams = false;
                    }
                    break;
                }
                const value = params[routeKey];
                combination[routeKey] = value;
                // Construct a unique key part for this parameter to enable deduplication.
                // We use type prefixes to prevent collisions between different value types
                // that might have the same string representation.
                //
                // Examples:
                // - Array ['foo', 'bar'] becomes "A:foo,bar"
                // - String "foo,bar" becomes "S:foo,bar"
                // - This prevents collisions between ['foo', 'bar'] and "foo,bar"
                let valuePart;
                if (Array.isArray(value)) {
                    valuePart = `A:${value.join(',')}`;
                } else {
                    valuePart = `S:${value}`;
                }
                keyParts.push(`${routeKey}:${valuePart}`);
            }
            // Build the final unique key by joining all parameter parts.
            // This key is used for deduplication in the combinations Map.
            // Format: "lang:S:en|region:S:US|slug:A:home,about"
            const currentKey = keyParts.join('|');
            // Only add the combination if it meets our criteria:
            // 1. hasAllRootParams: Contains all required Root Parameters
            // 2. !combinations.has(currentKey): Is not a duplicate of an existing combination
            //
            // This ensures we only generate valid, unique parameter combinations for Static Shells.
            if (hasAllRootParams && !combinations.has(currentKey)) {
                combinations.set(currentKey, combination);
            }
        }
    }
    // Convert the Map's values back into an array and return the final result.
    // The Map ensures all combinations are unique, and we return only the
    // parameter objects themselves, discarding the internal deduplication keys.
    return Array.from(combinations.values());
}
function calculateFallbackMode(dynamicParams, fallbackRootParams, baseFallbackMode) {
    return dynamicParams ? // perform a blocking static render.
    fallbackRootParams.length > 0 ? _fallback.FallbackMode.BLOCKING_STATIC_RENDER : baseFallbackMode ?? _fallback.FallbackMode.NOT_FOUND : _fallback.FallbackMode.NOT_FOUND;
}
/**
 * Validates the parameters to ensure they're accessible and have the correct
 * types.
 *
 * @param page - The page to validate.
 * @param regex - The route regex.
 * @param isRoutePPREnabled - Whether the route has partial prerendering enabled.
 * @param pathnameSegments - The keys of the parameters.
 * @param rootParamKeys - The keys of the root params.
 * @param routeParams - The list of parameters to validate.
 * @returns The list of validated parameters.
 */ function validateParams(page, isRoutePPREnabled, pathnameSegments, rootParamKeys, routeParams) {
    const valid = [];
    // Validate that if there are any root params, that the user has provided at
    // least one value for them only if we're using partial prerendering.
    if (isRoutePPREnabled && rootParamKeys.length > 0) {
        if (routeParams.length === 0 || rootParamKeys.some((key)=>routeParams.some((params)=>!(key in params)))) {
            if (rootParamKeys.length === 1) {
                throw Object.defineProperty(new Error(`A required root parameter (${rootParamKeys[0]}) was not provided in generateStaticParams for ${page}, please provide at least one value.`), "__NEXT_ERROR_CODE", {
                    value: "E622",
                    enumerable: false,
                    configurable: true
                });
            }
            throw Object.defineProperty(new Error(`Required root params (${rootParamKeys.join(', ')}) were not provided in generateStaticParams for ${page}, please provide at least one value for each.`), "__NEXT_ERROR_CODE", {
                value: "E621",
                enumerable: false,
                configurable: true
            });
        }
    }
    for (const params of routeParams){
        const item = {};
        for (const { paramName: key, paramType } of pathnameSegments){
            const { repeat, optional } = (0, _getsegmentparam.getParamProperties)(paramType);
            let paramValue = params[key];
            if (optional && params.hasOwnProperty(key) && (paramValue === null || paramValue === undefined || paramValue === false)) {
                paramValue = [];
            }
            // A parameter is missing, so the rest of the params are not accessible.
            // We only support this when the route has partial prerendering enabled.
            // This will make it so that the remaining params are marked as missing so
            // we can generate a fallback route for them.
            if (!paramValue && isRoutePPREnabled) {
                break;
            }
            // Perform validation for the parameter based on whether it's a repeat
            // parameter or not.
            if (repeat) {
                if (!Array.isArray(paramValue)) {
                    throw Object.defineProperty(new Error(`A required parameter (${key}) was not provided as an array received ${typeof paramValue} in generateStaticParams for ${page}`), "__NEXT_ERROR_CODE", {
                        value: "E618",
                        enumerable: false,
                        configurable: true
                    });
                }
            } else {
                if (typeof paramValue !== 'string') {
                    throw Object.defineProperty(new Error(`A required parameter (${key}) was not provided as a string received ${typeof paramValue} in generateStaticParams for ${page}`), "__NEXT_ERROR_CODE", {
                        value: "E617",
                        enumerable: false,
                        configurable: true
                    });
                }
            }
            item[key] = paramValue;
        }
        valid.push(item);
    }
    return valid;
}
function assignStaticShellMetadata(prerenderedRoutes, pathnameSegments, computeRemainingPrerenderableParams) {
    // If there are no routes to process, exit early.
    if (prerenderedRoutes.length === 0) {
        return;
    }
    // Initialize the root of the Trie. This node represents the starting point
    // before any parameters have been considered.
    const root = {
        children: new Map(),
        routes: []
    };
    // Phase 1: Build the Trie.
    // Iterate over each prerendered route and insert it into the Trie.
    // Each route's concrete parameter values form a path in the Trie.
    for (const route of prerenderedRoutes){
        let currentNode = root // Start building the path from the root for each route.
        ;
        // Iterate through the sorted parameter keys. The order of keys is crucial
        // for ensuring that routes with the same concrete parameters follow the
        // same path in the Trie, regardless of the original order of properties
        // in the `params` object.
        for (const { paramName: key } of pathnameSegments){
            // Check if the current route actually has a concrete value for this parameter.
            // If a dynamic segment is not filled (i.e., it's a fallback), it won't have
            // this property, and we stop building the path for this route at this point.
            if (route.params.hasOwnProperty(key)) {
                const value = route.params[key];
                // Generate a unique key for the parameter's value. This is critical
                // to prevent collisions between different data types that might have
                // the same string representation (e.g., `['a', 'b']` vs `'a,b'`).
                // A type prefix (`A:` for Array, `S:` for String, `U:` for undefined)
                // is added to the value to prevent collisions. This ensures that
                // different types with the same string representation are treated as
                // distinct.
                let valueKey;
                if (Array.isArray(value)) {
                    valueKey = `A:${value.join(',')}`;
                } else if (value === undefined) {
                    valueKey = `U:undefined`;
                } else {
                    valueKey = `S:${value}`;
                }
                // Look for a child node corresponding to this `valueKey` from the `currentNode`.
                let childNode = currentNode.children.get(valueKey);
                if (!childNode) {
                    // If the child node doesn't exist, create a new one and add it to
                    // the current node's children.
                    childNode = {
                        children: new Map(),
                        routes: []
                    };
                    currentNode.children.set(valueKey, childNode);
                }
                // Move deeper into the Trie to the `childNode` for the next parameter.
                currentNode = childNode;
            }
        }
        // After processing all concrete parameters for the route, add the full
        // `PrerenderedRoute` object to the `routes` array of the `currentNode`.
        // This node represents the unique concrete parameter combination for this route.
        currentNode.routes.push(route);
    }
    // Phase 2: Traverse the Trie to assign the `throwOnEmptyStaticShell` property.
    // This is done using an iterative Depth-First Search (DFS) approach with an
    // explicit stack to avoid JavaScript's recursion depth limits (stack overflow)
    // for very deep routing structures.
    const stack = [
        root
    ] // Initialize the stack with the root node.
    ;
    while(stack.length > 0){
        const node = stack.pop()// Pop the next node to process from the stack.
        ;
        // `hasChildren` indicates if this node has any more specific concrete
        // parameter combinations branching off from it. If true, it means this
        // node represents a prefix for other, more specific routes.
        const hasChildren = node.children.size > 0;
        // If the current node has routes associated with it (meaning, routes whose
        // concrete parameters lead to this node's path in the Trie).
        if (node.routes.length > 0) {
            // Determine the minimum number of fallback parameters among all routes
            // that are associated with this current Trie node. This is used to
            // identify if a route should not throw on empty static shell relative to another route *at the same level*
            // of concrete parameters, but with fewer fallback parameters.
            let minFallbacks = Infinity;
            for (const r of node.routes){
                // `fallbackRouteParams?.length ?? 0` handles cases where `fallbackRouteParams`
                // might be `undefined` or `null`, treating them as 0 length.
                minFallbacks = Math.min(minFallbacks, r.fallbackRouteParams ? r.fallbackRouteParams.length : 0);
            }
            // Now, for each `PrerenderedRoute` associated with this node:
            for (const route of node.routes){
                // A route is ok not to throw on an empty static shell (and thus
                // `throwOnEmptyStaticShell` should be `false`) if either of the
                // following conditions is met:
                // 1. `hasChildren` is true: This node has further concrete parameter children.
                //    This means the current route is a parent to more specific routes (e.g.,
                //    `/blog/[slug]` should not throw when concrete routes like `/blog/first-post` exist).
                // OR
                // 2. `route.fallbackRouteParams.length > minFallbacks`: This route has
                //    more fallback parameters than another route at the same Trie node.
                //    This implies the current route is a more general version that should not throw
                //    compared to a more specific route that has fewer fallback parameters
                //    (e.g., `/1234/[...slug]` should not throw relative to `/[id]/[...slug]`).
                if (hasChildren || route.fallbackRouteParams && route.fallbackRouteParams.length > minFallbacks) {
                    route.throwOnEmptyStaticShell = false // Should not throw on empty static shell.
                    ;
                } else {
                    route.throwOnEmptyStaticShell = true // Should throw on empty static shell.
                    ;
                }
                if (computeRemainingPrerenderableParams && route.fallbackRouteParams && route.fallbackRouteParams.length > 0) {
                    const fallbackRouteParamsByName = new Map(route.fallbackRouteParams.map((param)=>[
                            param.paramName,
                            param
                        ]));
                    const remainingPrerenderableParams = [];
                    // Only unresolved pathname params that can still be filled by
                    // generateStaticParams belong here. Once we hit an unresolved param
                    // that is purely dynamic, the rest of the shell also stays dynamic
                    // and cannot be completed into a more specific prerendered shell.
                    for (const segment of pathnameSegments){
                        if (route.params.hasOwnProperty(segment.paramName)) {
                            continue;
                        }
                        if (!segment.hasGenerateStaticParams) {
                            break;
                        }
                        const fallbackRouteParam = fallbackRouteParamsByName.get(segment.paramName);
                        if (!fallbackRouteParam) {
                            break;
                        }
                        remainingPrerenderableParams.push(fallbackRouteParam);
                    }
                    route.remainingPrerenderableParams = remainingPrerenderableParams.length > 0 ? remainingPrerenderableParams : undefined;
                }
            }
        }
        // Add all children of the current node to the stack. This ensures that
        // the traversal continues to explore deeper paths in the Trie.
        for (const child of node.children.values()){
            stack.push(child);
        }
    }
}
/**
 * Calls a single generateStaticParams function within a WorkUnitStore context,
 * making root param getters available during static param generation.
 */ async function callGenerateStaticParams(generateStaticParams, workUnitAsyncStorage, parentParams, rootParamKeys, implicitTags) {
    const rootParams = {};
    for (const key of rootParamKeys){
        if (key in parentParams) {
            rootParams[key] = parentParams[key];
        }
    }
    const workUnitStore = {
        type: 'generate-static-params',
        phase: 'render',
        implicitTags,
        rootParams
    };
    return workUnitAsyncStorage.run(workUnitStore, generateStaticParams, {
        params: parentParams
    });
}
async function generateRouteStaticParams(segments, store, workUnitAsyncStorage, isRoutePPREnabled, rootParamKeys) {
    // Early return if no segments to process
    if (segments.length === 0) return [];
    const implicitTags = await (0, _implicittags.getImplicitTags)(store.page, store.page, null);
    const queue = [
        {
            segmentIndex: 0,
            params: []
        }
    ];
    let currentParams = [];
    while(queue.length > 0){
        var _current_config;
        const { segmentIndex, params } = queue.shift();
        // If we've processed all segments, this is our final result
        if (segmentIndex >= segments.length) {
            currentParams = params;
            break;
        }
        const current = segments[segmentIndex];
        // Skip segments without generateStaticParams and continue to next
        if (typeof current.generateStaticParams !== 'function') {
            queue.push({
                segmentIndex: segmentIndex + 1,
                params
            });
            continue;
        }
        // Configure fetchCache if specified
        if (((_current_config = current.config) == null ? void 0 : _current_config.fetchCache) !== undefined) {
            store.fetchCache = current.config.fetchCache;
        }
        const nextParams = [];
        // If there are parent params, we need to process them.
        if (params.length > 0) {
            // Process each parent parameter combination
            for (const parentParams of params){
                const result = await callGenerateStaticParams(current.generateStaticParams, workUnitAsyncStorage, parentParams, rootParamKeys, implicitTags);
                if (result.length > 0) {
                    // Merge parent params with each result item
                    for (const item of result){
                        nextParams.push({
                            ...parentParams,
                            ...item
                        });
                    }
                } else if (isRoutePPREnabled) {
                    (0, _emptygeneratestaticparamserror.throwEmptyGenerateStaticParamsError)();
                } else {
                    // No results, just pass through parent params
                    nextParams.push(parentParams);
                }
            }
        } else {
            // No parent params, call generateStaticParams with empty object
            const result = await callGenerateStaticParams(current.generateStaticParams, workUnitAsyncStorage, {}, rootParamKeys, implicitTags);
            if (result.length === 0 && isRoutePPREnabled) {
                (0, _emptygeneratestaticparamserror.throwEmptyGenerateStaticParamsError)();
            }
            nextParams.push(...result);
        }
        // Add next segment to work queue
        queue.push({
            segmentIndex: segmentIndex + 1,
            params: nextParams
        });
    }
    return currentParams;
}
function createReplacements(segment, paramValue) {
    // Determine the prefix to use for the interception marker.
    let prefix;
    if (segment.paramType) {
        prefix = (0, _interceptionprefixfromparamtype.interceptionPrefixFromParamType)(segment.paramType) ?? '';
    } else {
        prefix = '';
    }
    return {
        pathname: prefix + (0, _utils.encodeParam)(paramValue, (value)=>// Only escape path delimiters if the value is a string, the following
            // version will URL encode the value.
            (0, _escapepathdelimiters.default)(value, true)),
        encodedPathname: prefix + (0, _utils.encodeParam)(paramValue, // URL encode the value.
        encodeURIComponent)
    };
}
async function buildAppStaticPaths({ dir, page, route, distDir, cacheComponents, authInterrupts, segments, isrFlushToDisk, cacheHandler, cacheLifeProfiles, requestHeaders, cacheHandlers, cacheMaxMemorySize, fetchCacheKeyPrefix, nextConfigOutput, ComponentMod, isRoutePPREnabled = false, partialFallbacksEnabled = false, buildId, rootParamKeys }) {
    if (segments.some((generate)=>{
        var _generate_config;
        return ((_generate_config = generate.config) == null ? void 0 : _generate_config.dynamicParams) === true;
    }) && nextConfigOutput === 'export') {
        throw Object.defineProperty(new Error('"dynamicParams: true" cannot be used with "output: export". See more info here: https://nextjs.org/docs/app/building-your-application/deploying/static-exports'), "__NEXT_ERROR_CODE", {
            value: "E393",
            enumerable: false,
            configurable: true
        });
    }
    ComponentMod.patchFetch();
    const incrementalCache = await (0, _createincrementalcache.createIncrementalCache)({
        dir,
        distDir,
        cacheHandler,
        cacheHandlers,
        requestHeaders,
        fetchCacheKeyPrefix,
        flushToDisk: isrFlushToDisk,
        cacheMaxMemorySize
    });
    // Extract segments that contribute to the pathname.
    // For AppPageRouteModule: Traverses the loader tree to find all segments (including
    //   interception routes in parallel slots) that match the pathname
    // For AppRouteRouteModule: Filters the segments array to get non-parallel route params
    const pathnameRouteParamSegments = (0, _utils.extractPathnameRouteParamSegments)(ComponentMod.routeModule, segments, route);
    const afterRunner = new _runwithafter.AfterRunner();
    const store = (0, _workstore.createWorkStore)({
        page,
        renderOpts: {
            incrementalCache,
            cacheLifeProfiles,
            supportsDynamicResponse: true,
            cacheComponents,
            experimental: {
                authInterrupts
            },
            waitUntil: afterRunner.context.waitUntil,
            onClose: afterRunner.context.onClose,
            onAfterTaskError: afterRunner.context.onTaskError
        },
        buildId,
        previouslyRevalidatedTags: []
    });
    const routeParams = await ComponentMod.workAsyncStorage.run(store, generateRouteStaticParams, segments, store, ComponentMod.workUnitAsyncStorage, isRoutePPREnabled, rootParamKeys);
    const generatedParamNames = new Set();
    for (const params of routeParams){
        for (const paramName of Object.keys(params)){
            generatedParamNames.add(paramName);
        }
    }
    const prerenderablePathSegments = pathnameRouteParamSegments.map((segment)=>({
            paramName: segment.paramName,
            hasGenerateStaticParams: generatedParamNames.has(segment.paramName)
        }));
    await afterRunner.executeAfter();
    let lastDynamicSegmentHadGenerateStaticParams = false;
    for (const segment of segments){
        var _segment_config;
        // Check to see if there are any missing params for segments that have
        // dynamicParams set to false.
        if (segment.paramName && segment.paramType && ((_segment_config = segment.config) == null ? void 0 : _segment_config.dynamicParams) === false) {
            for (const params of routeParams){
                if (segment.paramName in params) continue;
                const relative = segment.filePath ? _nodepath.default.relative(dir, segment.filePath) : undefined;
                throw Object.defineProperty(new Error(`Segment "${relative}" exports "dynamicParams: false" but the param "${segment.paramName}" is missing from the generated route params.`), "__NEXT_ERROR_CODE", {
                    value: "E280",
                    enumerable: false,
                    configurable: true
                });
            }
        }
        if (segment.paramName && segment.paramType && typeof segment.generateStaticParams !== 'function') {
            lastDynamicSegmentHadGenerateStaticParams = false;
        } else if (typeof segment.generateStaticParams === 'function') {
            lastDynamicSegmentHadGenerateStaticParams = true;
        }
    }
    // Determine if all the segments have had their parameters provided.
    const hadAllParamsGenerated = pathnameRouteParamSegments.length === 0 || routeParams.length > 0 && routeParams.every((params)=>{
        for (const { paramName } of pathnameRouteParamSegments){
            if (paramName in params) continue;
            return false;
        }
        return true;
    });
    // TODO: dynamic params should be allowed to be granular per segment but
    // we need additional information stored/leveraged in the prerender
    // manifest to allow this behavior.
    const dynamicParams = segments.every((segment)=>{
        var _segment_config;
        return ((_segment_config = segment.config) == null ? void 0 : _segment_config.dynamicParams) !== false;
    });
    const supportsRoutePreGeneration = hadAllParamsGenerated || !process.env.__NEXT_DEV_SERVER;
    const fallbackMode = dynamicParams ? supportsRoutePreGeneration ? isRoutePPREnabled ? _fallback.FallbackMode.PRERENDER : _fallback.FallbackMode.BLOCKING_STATIC_RENDER : undefined : _fallback.FallbackMode.NOT_FOUND;
    const prerenderedRoutesByPathname = new Map();
    // Convert rootParamKeys to Set for O(1) lookup.
    const rootParamSet = new Set(rootParamKeys);
    if (hadAllParamsGenerated || isRoutePPREnabled) {
        let paramsToProcess = routeParams;
        if (isRoutePPREnabled) {
            // Discover all unique combinations of the routeParams so we can generate
            // routes that won't throw on empty static shell for each of them if
            // they're available.
            paramsToProcess = generateAllParamCombinations(pathnameRouteParamSegments, routeParams, rootParamKeys);
            // Collect all the fallback route params for the segments.
            const fallbackRouteParams = [];
            for (const segment of segments){
                if (!segment.paramName || !segment.paramType) continue;
                fallbackRouteParams.push({
                    paramName: segment.paramName,
                    paramType: segment.paramType
                });
            }
            // Add the base route, this is the route with all the placeholders as it's
            // derived from the `page` string.
            prerenderedRoutesByPathname.set(page, {
                params: {},
                pathname: page,
                encodedPathname: page,
                fallbackRouteParams,
                fallbackMode: calculateFallbackMode(dynamicParams, rootParamKeys, fallbackMode),
                fallbackRootParams: rootParamKeys,
                throwOnEmptyStaticShell: true
            });
        }
        filterUniqueParams(pathnameRouteParamSegments, validateParams(page, isRoutePPREnabled, pathnameRouteParamSegments, rootParamKeys, paramsToProcess)).forEach((params)=>{
            let pathname = page;
            let encodedPathname = page;
            const fallbackRouteParams = [];
            for (const { name, paramName, paramType } of pathnameRouteParamSegments){
                const paramValue = params[paramName];
                if (!paramValue) {
                    if (isRoutePPREnabled) {
                        // Mark remaining params as fallback params.
                        fallbackRouteParams.push({
                            paramName,
                            paramType
                        });
                        for(let i = pathnameRouteParamSegments.findIndex((param)=>param.paramName === paramName) + 1; i < pathnameRouteParamSegments.length; i++){
                            fallbackRouteParams.push({
                                paramName: pathnameRouteParamSegments[i].paramName,
                                paramType: pathnameRouteParamSegments[i].paramType
                            });
                        }
                        break;
                    } else {
                        // This route is not complete, and we aren't performing a partial
                        // prerender, so we should return, skipping this route.
                        return;
                    }
                }
                const replacements = createReplacements({
                    paramType
                }, paramValue);
                pathname = pathname.replace(name, // We're replacing the segment name with the replacement pathname
                // which will include the interception marker prefix if it exists.
                replacements.pathname);
                encodedPathname = encodedPathname.replace(name, // We're replacing the segment name with the replacement encoded
                // pathname which will include the encoded param value.
                replacements.encodedPathname);
            }
            // Resolve all route params from the loader tree if this is from an
            // app page. This processes both regular route params and parallel route params.
            if ('loaderTree' in ComponentMod.routeModule.userland && Array.isArray(ComponentMod.routeModule.userland.loaderTree)) {
                (0, _utils.resolveRouteParamsFromTree)(ComponentMod.routeModule.userland.loaderTree, params, route, fallbackRouteParams);
            }
            const fallbackRootParams = [];
            for (const { paramName } of fallbackRouteParams){
                // If the param is a root param then we can add it to the fallback
                // root params.
                if (rootParamSet.has(paramName)) {
                    fallbackRootParams.push(paramName);
                }
            }
            pathname = (0, _utils.normalizePathname)(pathname);
            prerenderedRoutesByPathname.set(pathname, {
                params,
                pathname,
                encodedPathname: (0, _utils.normalizePathname)(encodedPathname),
                fallbackRouteParams,
                fallbackMode: calculateFallbackMode(dynamicParams, fallbackRootParams, fallbackMode),
                fallbackRootParams,
                throwOnEmptyStaticShell: true
            });
        });
    }
    const prerenderedRoutes = prerenderedRoutesByPathname.size > 0 || lastDynamicSegmentHadGenerateStaticParams ? [
        ...prerenderedRoutesByPathname.values()
    ] : undefined;
    // Now we have to set the throwOnEmptyStaticShell for each of the routes.
    if (prerenderedRoutes && cacheComponents) {
        assignStaticShellMetadata(prerenderedRoutes, prerenderablePathSegments, partialFallbacksEnabled);
    }
    return {
        fallbackMode,
        prerenderedRoutes
    };
}

//# sourceMappingURL=app.js.map