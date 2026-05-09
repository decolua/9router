"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    createComponentTree: null,
    getRootParams: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    createComponentTree: function() {
        return createComponentTree;
    },
    getRootParams: function() {
        return getRootParams;
    }
});
const _clientandserverreferences = require("../../lib/client-and-server-references");
const _appdirmodule = require("../lib/app-dir-module");
const _interopdefault = require("./interop-default");
const _parseloadertree = require("../../shared/lib/router/utils/parse-loader-tree");
const _createcomponentstylesandscripts = require("./create-component-styles-and-scripts");
const _getlayerassets = require("./get-layer-assets");
const _hasloadingcomponentintree = require("./has-loading-component-in-tree");
const _patchfetch = require("../lib/patch-fetch");
const _default = require("../../client/components/builtin/default");
const _tracer = require("../lib/trace/tracer");
const _constants = require("../lib/trace/constants");
const _staticgenerationbailout = require("../../client/components/static-generation-bailout");
const _workunitasyncstorageexternal = require("./work-unit-async-storage.external");
const _varyparams = require("./vary-params");
const _segment = require("../../shared/lib/segment");
const _segmentexplorerpath = require("./segment-explorer-path");
const _stagedrendering = require("./staged-rendering");
function createComponentTree(props) {
    return (0, _tracer.getTracer)().trace(_constants.NextNodeServerSpan.createComponentTree, {
        spanName: 'build component tree'
    }, ()=>createComponentTreeInternal(props, true));
}
function errorMissingDefaultExport(pagePath, convention) {
    const normalizedPagePath = pagePath === '/' ? '' : pagePath;
    throw Object.defineProperty(new Error(`The default export is not a React Component in "${normalizedPagePath}/${convention}"`), "__NEXT_ERROR_CODE", {
        value: "E45",
        enumerable: false,
        configurable: true
    });
}
const cacheNodeKey = 'c';
async function createComponentTreeInternal({ loaderTree: tree, parentParams, parentOptionalCatchAllParamName, parentRuntimePrefetchable, rootLayoutIncluded, injectedCSS, injectedJS, injectedFontPreloadTags, ctx, missingSlots, preloadCallbacks, authInterrupts, MetadataOutlet }, isRoot) {
    const { renderOpts: { nextConfigOutput, experimental, cacheComponents }, workStore, componentMod: { createElement, Fragment, SegmentViewNode, HTTPAccessFallbackBoundary, LayoutRouter, RenderFromTemplateContext, ClientPageRoot, ClientSegmentRoot, createServerSearchParamsForServerPage, createPrerenderSearchParamsForClientPage, createServerParamsForServerSegment, createPrerenderParamsForClientSegment, serverHooks: { DynamicServerError }, Postpone }, pagePath, getDynamicParamFromSegment, isPrefetch, query } = ctx;
    const { page, conventionPath, segment, modules, parallelRoutes } = (0, _parseloadertree.parseLoaderTree)(tree);
    const { layout, template, error, loading, 'not-found': notFound, forbidden, unauthorized } = modules;
    const injectedCSSWithCurrentLayout = new Set(injectedCSS);
    const injectedJSWithCurrentLayout = new Set(injectedJS);
    const injectedFontPreloadTagsWithCurrentLayout = new Set(injectedFontPreloadTags);
    const layerAssets = (0, _getlayerassets.getLayerAssets)({
        preloadCallbacks,
        ctx,
        layoutOrPagePath: conventionPath,
        injectedCSS: injectedCSSWithCurrentLayout,
        injectedJS: injectedJSWithCurrentLayout,
        injectedFontPreloadTags: injectedFontPreloadTagsWithCurrentLayout
    });
    const [Template, templateStyles, templateScripts] = template ? await (0, _createcomponentstylesandscripts.createComponentStylesAndScripts)({
        ctx,
        filePath: template[1],
        getComponent: template[0],
        injectedCSS: injectedCSSWithCurrentLayout,
        injectedJS: injectedJSWithCurrentLayout
    }) : [
        Fragment
    ];
    const [ErrorComponent, errorStyles, errorScripts] = error ? await (0, _createcomponentstylesandscripts.createComponentStylesAndScripts)({
        ctx,
        filePath: error[1],
        getComponent: error[0],
        injectedCSS: injectedCSSWithCurrentLayout,
        injectedJS: injectedJSWithCurrentLayout
    }) : [];
    const [Loading, loadingStyles, loadingScripts] = loading ? await (0, _createcomponentstylesandscripts.createComponentStylesAndScripts)({
        ctx,
        filePath: loading[1],
        getComponent: loading[0],
        injectedCSS: injectedCSSWithCurrentLayout,
        injectedJS: injectedJSWithCurrentLayout
    }) : [];
    const isLayout = typeof layout !== 'undefined';
    const isPage = typeof page !== 'undefined';
    const { mod: layoutOrPageMod, modType } = await (0, _tracer.getTracer)().trace(_constants.NextNodeServerSpan.getLayoutOrPageModule, {
        hideSpan: !(isLayout || isPage),
        spanName: 'resolve segment modules',
        attributes: {
            'next.segment': segment
        }
    }, ()=>(0, _appdirmodule.getLayoutOrPageModule)(tree));
    /**
   * Checks if the current segment is a root layout.
   */ const rootLayoutAtThisLevel = isLayout && !rootLayoutIncluded;
    /**
   * Checks if the current segment or any level above it has a root layout.
   */ const rootLayoutIncludedAtThisLevelOrAbove = rootLayoutIncluded || rootLayoutAtThisLevel;
    const [NotFound, notFoundStyles] = notFound ? await (0, _createcomponentstylesandscripts.createComponentStylesAndScripts)({
        ctx,
        filePath: notFound[1],
        getComponent: notFound[0],
        injectedCSS: injectedCSSWithCurrentLayout,
        injectedJS: injectedJSWithCurrentLayout
    }) : [];
    const instantConfig = layoutOrPageMod ? layoutOrPageMod.unstable_instant : undefined;
    const hasRuntimePrefetch = instantConfig && typeof instantConfig === 'object' ? instantConfig.prefetch === 'runtime' : false;
    const isRuntimePrefetchable = hasRuntimePrefetch || parentRuntimePrefetchable;
    const [Forbidden, forbiddenStyles] = authInterrupts && forbidden ? await (0, _createcomponentstylesandscripts.createComponentStylesAndScripts)({
        ctx,
        filePath: forbidden[1],
        getComponent: forbidden[0],
        injectedCSS: injectedCSSWithCurrentLayout,
        injectedJS: injectedJSWithCurrentLayout
    }) : [];
    const [Unauthorized, unauthorizedStyles] = authInterrupts && unauthorized ? await (0, _createcomponentstylesandscripts.createComponentStylesAndScripts)({
        ctx,
        filePath: unauthorized[1],
        getComponent: unauthorized[0],
        injectedCSS: injectedCSSWithCurrentLayout,
        injectedJS: injectedJSWithCurrentLayout
    }) : [];
    let dynamic = layoutOrPageMod == null ? void 0 : layoutOrPageMod.dynamic;
    if (nextConfigOutput === 'export') {
        if (!dynamic || dynamic === 'auto') {
            dynamic = 'error';
        } else if (dynamic === 'force-dynamic') {
            // force-dynamic is always incompatible with 'export'. We must interrupt the build
            throw Object.defineProperty(new _staticgenerationbailout.StaticGenBailoutError(`Page with \`dynamic = "force-dynamic"\` couldn't be exported. \`output: "export"\` requires all pages be renderable statically because there is no runtime server to dynamically render routes in this output format. Learn more: https://nextjs.org/docs/app/building-your-application/deploying/static-exports`), "__NEXT_ERROR_CODE", {
                value: "E527",
                enumerable: false,
                configurable: true
            });
        }
    }
    if (typeof dynamic === 'string') {
        // the nested most config wins so we only force-static
        // if it's configured above any parent that configured
        // otherwise
        if (dynamic === 'error') {
            workStore.dynamicShouldError = true;
        } else if (dynamic === 'force-dynamic') {
            workStore.forceDynamic = true;
            // TODO: (PPR) remove this bailout once PPR is the default
            if (workStore.isStaticGeneration && !experimental.isRoutePPREnabled) {
                // If the postpone API isn't available, we can't postpone the render and
                // therefore we can't use the dynamic API.
                const err = Object.defineProperty(new DynamicServerError(`Page with \`dynamic = "force-dynamic"\` won't be rendered statically.`), "__NEXT_ERROR_CODE", {
                    value: "E585",
                    enumerable: false,
                    configurable: true
                });
                workStore.dynamicUsageDescription = err.message;
                workStore.dynamicUsageStack = err.stack;
                throw err;
            }
        } else {
            workStore.dynamicShouldError = false;
            workStore.forceStatic = dynamic === 'force-static';
        }
    }
    if (typeof (layoutOrPageMod == null ? void 0 : layoutOrPageMod.fetchCache) === 'string') {
        workStore.fetchCache = layoutOrPageMod == null ? void 0 : layoutOrPageMod.fetchCache;
    }
    if (typeof (layoutOrPageMod == null ? void 0 : layoutOrPageMod.revalidate) !== 'undefined') {
        (0, _patchfetch.validateRevalidate)(layoutOrPageMod == null ? void 0 : layoutOrPageMod.revalidate, workStore.route);
    }
    if (typeof (layoutOrPageMod == null ? void 0 : layoutOrPageMod.revalidate) === 'number') {
        const defaultRevalidate = layoutOrPageMod.revalidate;
        const workUnitStore = _workunitasyncstorageexternal.workUnitAsyncStorage.getStore();
        if (workUnitStore) {
            switch(workUnitStore.type){
                case 'prerender':
                case 'prerender-runtime':
                case 'prerender-legacy':
                case 'prerender-ppr':
                    if (workUnitStore.revalidate > defaultRevalidate) {
                        workUnitStore.revalidate = defaultRevalidate;
                    }
                    break;
                case 'request':
                    break;
                // createComponentTree is not called for these stores:
                case 'cache':
                case 'private-cache':
                case 'prerender-client':
                case 'validation-client':
                case 'unstable-cache':
                case 'generate-static-params':
                    break;
                default:
                    workUnitStore;
            }
        }
        if (!workStore.forceStatic && workStore.isStaticGeneration && defaultRevalidate === 0 && // If the postpone API isn't available, we can't postpone the render and
        // therefore we can't use the dynamic API.
        !experimental.isRoutePPREnabled) {
            const dynamicUsageDescription = `revalidate: 0 configured ${segment}`;
            workStore.dynamicUsageDescription = dynamicUsageDescription;
            throw Object.defineProperty(new DynamicServerError(dynamicUsageDescription), "__NEXT_ERROR_CODE", {
                value: "E1005",
                enumerable: false,
                configurable: true
            });
        }
    }
    // Read unstable_dynamicStaleTime from page modules (not layouts) and track it on
    // the store's stale field. This affects the segment cache stale time via
    // the StaleTimeIterable.
    if (isPage && typeof (layoutOrPageMod == null ? void 0 : layoutOrPageMod.unstable_dynamicStaleTime) === 'number') {
        const pageStaleTime = layoutOrPageMod.unstable_dynamicStaleTime;
        const workUnitStore = _workunitasyncstorageexternal.workUnitAsyncStorage.getStore();
        if (workUnitStore) {
            switch(workUnitStore.type){
                case 'prerender':
                case 'prerender-runtime':
                case 'prerender-legacy':
                case 'prerender-ppr':
                    if (workUnitStore.stale > pageStaleTime) {
                        workUnitStore.stale = pageStaleTime;
                    }
                    break;
                case 'request':
                    if (workUnitStore.stale === undefined || workUnitStore.stale > pageStaleTime) {
                        workUnitStore.stale = pageStaleTime;
                    }
                    break;
                // createComponentTree is not called for these stores:
                case 'cache':
                case 'private-cache':
                case 'prerender-client':
                case 'validation-client':
                case 'unstable-cache':
                case 'generate-static-params':
                    break;
                default:
                    workUnitStore;
            }
        }
    }
    const isStaticGeneration = workStore.isStaticGeneration;
    // Assume the segment we're rendering contains only partial data if PPR is
    // enabled and this is a statically generated response. This is used by the
    // client Segment Cache after a prefetch to determine if it can skip the
    // second request to fill in the dynamic data.
    //
    // It's OK for this to be `true` when the data is actually fully static, but
    // it's not OK for this to be `false` when the data possibly contains holes.
    // Although the value here is overly pessimistic, for prefetches, it will be
    // replaced by a more specific value when the data is later processed into
    // per-segment responses (see collect-segment-data.tsx)
    //
    // For dynamic requests, this must always be `false` because dynamic responses
    // are never partial.
    const isPossiblyPartialResponse = isStaticGeneration && experimental.isRoutePPREnabled === true;
    const LayoutOrPage = layoutOrPageMod ? (0, _interopdefault.interopDefault)(layoutOrPageMod) : undefined;
    /**
   * The React Component to render.
   */ let MaybeComponent = LayoutOrPage;
    if (process.env.NODE_ENV === 'development' || isStaticGeneration) {
        const { isValidElementType } = require('next/dist/compiled/react-is');
        if (typeof MaybeComponent !== 'undefined' && !isValidElementType(MaybeComponent)) {
            errorMissingDefaultExport(pagePath, modType ?? 'page');
        }
        if (typeof ErrorComponent !== 'undefined' && !isValidElementType(ErrorComponent)) {
            errorMissingDefaultExport(pagePath, 'error');
        }
        if (typeof Loading !== 'undefined' && !isValidElementType(Loading)) {
            errorMissingDefaultExport(pagePath, 'loading');
        }
        if (typeof NotFound !== 'undefined' && !isValidElementType(NotFound)) {
            errorMissingDefaultExport(pagePath, 'not-found');
        }
        if (typeof Forbidden !== 'undefined' && !isValidElementType(Forbidden)) {
            errorMissingDefaultExport(pagePath, 'forbidden');
        }
        if (typeof Unauthorized !== 'undefined' && !isValidElementType(Unauthorized)) {
            errorMissingDefaultExport(pagePath, 'unauthorized');
        }
    }
    // Handle dynamic segment params.
    const segmentParam = getDynamicParamFromSegment(tree);
    // Create object holding the parent params and current params
    let currentParams = parentParams;
    if (segmentParam && segmentParam.value !== null) {
        currentParams = {
            ...parentParams,
            [segmentParam.param]: segmentParam.value
        };
    }
    // Track optional catch-all params with no value (e.g., [[...slug]] at /).
    // These params won't exist as properties on the params object, so vary
    // params tracking needs to use a Proxy to detect access. We propagate this
    // through the tree so that child segments (like __PAGE__) also know about
    // the missing param. In practice, this only gets passed down one level —
    // from the optional catch-all layout segment to the page segment — so it's
    // always very close to the leaf of the tree.
    const optionalCatchAllParamName = (segmentParam == null ? void 0 : segmentParam.type) === 'oc' && segmentParam.value === null ? segmentParam.param : parentOptionalCatchAllParamName;
    // Resolve the segment param
    const isSegmentViewEnabled = !!process.env.__NEXT_DEV_SERVER;
    const dir = (process.env.NEXT_RUNTIME === 'edge' ? process.env.__NEXT_EDGE_PROJECT_DIR : ctx.renderOpts.dir) || '';
    const [notFoundElement, notFoundFilePath] = await createBoundaryConventionElement({
        ctx,
        conventionName: 'not-found',
        Component: NotFound,
        styles: notFoundStyles,
        tree
    });
    const [forbiddenElement] = await createBoundaryConventionElement({
        ctx,
        conventionName: 'forbidden',
        Component: Forbidden,
        styles: forbiddenStyles,
        tree
    });
    const [unauthorizedElement] = await createBoundaryConventionElement({
        ctx,
        conventionName: 'unauthorized',
        Component: Unauthorized,
        styles: unauthorizedStyles,
        tree
    });
    // TODO: Combine this `map` traversal with the loop below that turns the array
    // into an object.
    const parallelRouteMap = await Promise.all(Object.keys(parallelRoutes).map(async (parallelRouteKey)=>{
        const isChildrenRouteKey = parallelRouteKey === 'children';
        const parallelRoute = parallelRoutes[parallelRouteKey];
        const notFoundComponent = isChildrenRouteKey ? notFoundElement : undefined;
        const forbiddenComponent = isChildrenRouteKey ? forbiddenElement : undefined;
        const unauthorizedComponent = isChildrenRouteKey ? unauthorizedElement : undefined;
        // if we're prefetching and that there's a Loading component, we bail out
        // otherwise we keep rendering for the prefetch.
        // We also want to bail out if there's no Loading component in the tree.
        let childCacheNodeSeedData = null;
        if (// Before PPR, the way instant navigations work in Next.js is we
        // prefetch everything up to the first route segment that defines a
        // loading.tsx boundary. (We do the same if there's no loading
        // boundary in the entire tree, because we don't want to prefetch too
        // much) The rest of the tree is deferred until the actual navigation.
        // It does not take into account whether the data is dynamic — even if
        // the tree is completely static, it will still defer everything
        // inside the loading boundary.
        //
        // This behavior predates PPR and is only relevant if the
        // PPR flag is not enabled.
        isPrefetch && (Loading || !(0, _hasloadingcomponentintree.hasLoadingComponentInTree)(parallelRoute)) && // The approach with PPR is different — loading.tsx behaves like a
        // regular Suspense boundary and has no special behavior.
        //
        // With PPR, we prefetch as deeply as possible, and only defer when
        // dynamic data is accessed. If so, we only defer the nearest parent
        // Suspense boundary of the dynamic data access, regardless of whether
        // the boundary is defined by loading.tsx or a normal <Suspense>
        // component in userspace.
        //
        // NOTE: In practice this usually means we'll end up prefetching more
        // than we were before PPR, which may or may not be considered a
        // performance regression by some apps. The plan is to address this
        // before General Availability of PPR by introducing granular
        // per-segment fetching, so we can reuse as much of the tree as
        // possible during both prefetches and dynamic navigations. But during
        // the beta period, we should be clear about this trade off in our
        // communications.
        !experimental.isRoutePPREnabled) {
        // Don't prefetch this child. This will trigger a lazy fetch by the
        // client router.
        } else {
            // Create the child component
            if (process.env.NODE_ENV === 'development' && missingSlots) {
                var _parsedTree_conventionPath;
                // When we detect the default fallback (which triggers a 404), we collect the missing slots
                // to provide more helpful debug information during development mode.
                const parsedTree = (0, _parseloadertree.parseLoaderTree)(parallelRoute);
                if ((_parsedTree_conventionPath = parsedTree.conventionPath) == null ? void 0 : _parsedTree_conventionPath.endsWith(_default.PARALLEL_ROUTE_DEFAULT_PATH)) {
                    missingSlots.add(parallelRouteKey);
                }
            }
            const seedData = await createComponentTreeInternal({
                loaderTree: parallelRoute,
                parentParams: currentParams,
                parentOptionalCatchAllParamName: optionalCatchAllParamName,
                parentRuntimePrefetchable: isRuntimePrefetchable,
                rootLayoutIncluded: rootLayoutIncludedAtThisLevelOrAbove,
                injectedCSS: injectedCSSWithCurrentLayout,
                injectedJS: injectedJSWithCurrentLayout,
                injectedFontPreloadTags: injectedFontPreloadTagsWithCurrentLayout,
                ctx,
                missingSlots,
                preloadCallbacks,
                authInterrupts,
                // `StreamingMetadataOutlet` is used to conditionally throw. In the case of parallel routes we will have more than one page
                // but we only want to throw on the first one.
                MetadataOutlet: isChildrenRouteKey ? MetadataOutlet : null
            }, false);
            childCacheNodeSeedData = seedData;
        }
        const templateNode = createElement(Template, null, createElement(RenderFromTemplateContext, null));
        const templateFilePath = (0, _segmentexplorerpath.getConventionPathByType)(tree, dir, 'template');
        const errorFilePath = (0, _segmentexplorerpath.getConventionPathByType)(tree, dir, 'error');
        const loadingFilePath = (0, _segmentexplorerpath.getConventionPathByType)(tree, dir, 'loading');
        const globalErrorFilePath = isRoot ? (0, _segmentexplorerpath.getConventionPathByType)(tree, dir, 'global-error') : undefined;
        const wrappedErrorStyles = isSegmentViewEnabled && errorFilePath ? createElement(SegmentViewNode, {
            type: 'error',
            pagePath: errorFilePath
        }, errorStyles) : errorStyles;
        // Add a suffix to avoid conflict with the segment view node representing rendered file.
        // existence: not-found.tsx@boundary
        // rendered: not-found.tsx
        const fileNameSuffix = _segmentexplorerpath.BOUNDARY_SUFFIX;
        const segmentViewBoundaries = isSegmentViewEnabled ? createElement(Fragment, null, notFoundFilePath && createElement(SegmentViewNode, {
            type: `${_segmentexplorerpath.BOUNDARY_PREFIX}not-found`,
            pagePath: notFoundFilePath + fileNameSuffix
        }), loadingFilePath && createElement(SegmentViewNode, {
            type: `${_segmentexplorerpath.BOUNDARY_PREFIX}loading`,
            pagePath: loadingFilePath + fileNameSuffix
        }), errorFilePath && createElement(SegmentViewNode, {
            type: `${_segmentexplorerpath.BOUNDARY_PREFIX}error`,
            pagePath: errorFilePath + fileNameSuffix
        }), globalErrorFilePath && createElement(SegmentViewNode, {
            type: `${_segmentexplorerpath.BOUNDARY_PREFIX}global-error`,
            pagePath: (0, _segmentexplorerpath.isNextjsBuiltinFilePath)(globalErrorFilePath) ? `${_segmentexplorerpath.BUILTIN_PREFIX}global-error.js${fileNameSuffix}` : globalErrorFilePath
        })) : null;
        return [
            parallelRouteKey,
            createElement(LayoutRouter, {
                parallelRouterKey: parallelRouteKey,
                error: ErrorComponent,
                errorStyles: wrappedErrorStyles,
                errorScripts: errorScripts,
                template: isSegmentViewEnabled && templateFilePath ? createElement(SegmentViewNode, {
                    type: 'template',
                    pagePath: templateFilePath
                }, templateNode) : templateNode,
                templateStyles: templateStyles,
                templateScripts: templateScripts,
                notFound: notFoundComponent,
                forbidden: forbiddenComponent,
                unauthorized: unauthorizedComponent,
                ...isSegmentViewEnabled && {
                    segmentViewBoundaries
                }
            }),
            childCacheNodeSeedData
        ];
    }));
    // Convert the parallel route map into an object after all promises have been resolved.
    let parallelRouteProps = {};
    let parallelRouteCacheNodeSeedData = {};
    for (const parallelRoute of parallelRouteMap){
        const [parallelRouteKey, parallelRouteProp, flightData] = parallelRoute;
        parallelRouteProps[parallelRouteKey] = parallelRouteProp;
        parallelRouteCacheNodeSeedData[parallelRouteKey] = flightData;
    }
    let loadingElement = Loading ? createElement(Loading, {
        key: 'l'
    }) : null;
    const loadingFilePath = (0, _segmentexplorerpath.getConventionPathByType)(tree, dir, 'loading');
    if (isSegmentViewEnabled && loadingElement) {
        if (loadingFilePath) {
            loadingElement = createElement(SegmentViewNode, {
                key: cacheNodeKey + '-loading',
                type: 'loading',
                pagePath: loadingFilePath
            }, loadingElement);
        }
    }
    const loadingData = loadingElement ? [
        loadingElement,
        loadingStyles,
        loadingScripts
    ] : null;
    // When the segment does not have a layout or page we still have to add the layout router to ensure the path holds the loading component
    if (!MaybeComponent) {
        return createSeedData(ctx, createElement(Fragment, {
            key: cacheNodeKey
        }, layerAssets, parallelRouteProps.children), parallelRouteCacheNodeSeedData, loadingData, isPossiblyPartialResponse, isRuntimePrefetchable, // No user-provided component, so no params will be accessed. Use the
        // pre-resolved empty tracker.
        _varyparams.emptyVaryParamsAccumulator);
    }
    const Component = MaybeComponent;
    // If force-dynamic is used and the current render supports postponing, we
    // replace it with a node that will postpone the render. This ensures that the
    // postpone is invoked during the react render phase and not during the next
    // render phase.
    // @TODO this does not actually do what it seems like it would or should do. The idea is that
    // if we are rendering in a force-dynamic mode and we can postpone we should only make the segments
    // that ask for force-dynamic to be dynamic, allowing other segments to still prerender. However
    // because this comes after the children traversal and the static generation store is mutated every segment
    // along the parent path of a force-dynamic segment will hit this condition effectively making the entire
    // render force-dynamic. We should refactor this function so that we can correctly track which segments
    // need to be dynamic
    if (workStore.isStaticGeneration && workStore.forceDynamic && experimental.isRoutePPREnabled) {
        return createSeedData(ctx, createElement(Fragment, {
            key: cacheNodeKey
        }, createElement(Postpone, {
            reason: 'dynamic = "force-dynamic" was used',
            route: workStore.route
        }), layerAssets), parallelRouteCacheNodeSeedData, loadingData, true, isRuntimePrefetchable, // force-dynamic postpones without rendering the component, so no params
        // are accessed. The vary params are empty.
        _varyparams.emptyVaryParamsAccumulator);
    }
    const isClientComponent = (0, _clientandserverreferences.isClientReference)(layoutOrPageMod);
    const varyParamsAccumulator = isClientComponent && cacheComponents ? // from the server, so they have an empty vary params set.
    _varyparams.emptyVaryParamsAccumulator : (0, _varyparams.createVaryParamsAccumulator)();
    if (process.env.NODE_ENV === 'development' && 'params' in parallelRouteProps) {
        // @TODO consider making this an error and running the check in build as well
        console.error(`"params" is a reserved prop in Layouts and Pages and cannot be used as the name of a parallel route in ${segment}`);
    }
    if (isPage) {
        const PageComponent = Component;
        // Assign searchParams to props if this is a page
        let pageElement;
        if (isClientComponent) {
            if (cacheComponents) {
                // Params are omitted when Cache Components is enabled
                pageElement = createElement(ClientPageRoot, {
                    Component: PageComponent,
                    serverProvidedParams: null
                });
            } else if (isStaticGeneration) {
                const promiseOfParams = createPrerenderParamsForClientSegment(currentParams);
                const promiseOfSearchParams = createPrerenderSearchParamsForClientPage();
                pageElement = createElement(ClientPageRoot, {
                    Component: PageComponent,
                    serverProvidedParams: {
                        searchParams: query,
                        params: currentParams,
                        promises: [
                            promiseOfSearchParams,
                            promiseOfParams
                        ]
                    }
                });
            } else {
                pageElement = createElement(ClientPageRoot, {
                    Component: PageComponent,
                    serverProvidedParams: {
                        searchParams: query,
                        params: currentParams,
                        promises: null
                    }
                });
            }
        } else {
            // If we are passing params to a server component Page we need to track
            // their usage in case the current render mode tracks dynamic API usage.
            const params = createServerParamsForServerSegment(currentParams, optionalCatchAllParamName, varyParamsAccumulator, isRuntimePrefetchable);
            // If we are passing searchParams to a server component Page we need to
            // track their usage in case the current render mode tracks dynamic API
            // usage.
            let searchParams = createServerSearchParamsForServerPage(query, varyParamsAccumulator, isRuntimePrefetchable);
            if ((0, _clientandserverreferences.isUseCacheFunction)(PageComponent)) {
                const UseCachePageComponent = PageComponent;
                pageElement = createElement(UseCachePageComponent, {
                    params: params,
                    searchParams: searchParams,
                    $$isPage: true
                });
            } else {
                pageElement = createElement(PageComponent, {
                    params: params,
                    searchParams: searchParams
                });
            }
        }
        const isDefaultSegment = segment === _segment.DEFAULT_SEGMENT_KEY;
        const pageFilePath = (0, _segmentexplorerpath.getConventionPathByType)(tree, dir, 'page') ?? (0, _segmentexplorerpath.getConventionPathByType)(tree, dir, 'defaultPage');
        const segmentType = isDefaultSegment ? 'default' : 'page';
        const wrappedPageElement = isSegmentViewEnabled && pageFilePath ? createElement(SegmentViewNode, {
            key: cacheNodeKey + '-' + segmentType,
            type: segmentType,
            pagePath: pageFilePath
        }, pageElement) : pageElement;
        return createSeedData(ctx, createElement(Fragment, {
            key: cacheNodeKey
        }, wrappedPageElement, layerAssets, MetadataOutlet ? createElement(MetadataOutlet, null) : null), parallelRouteCacheNodeSeedData, loadingData, isPossiblyPartialResponse, isRuntimePrefetchable, varyParamsAccumulator);
    } else {
        const SegmentComponent = Component;
        const isRootLayoutWithChildrenSlotAndAtLeastOneMoreSlot = rootLayoutAtThisLevel && 'children' in parallelRoutes && Object.keys(parallelRoutes).length > 1;
        let segmentNode;
        if (isClientComponent) {
            let clientSegment;
            if (cacheComponents) {
                // Params are omitted when Cache Components is enabled
                clientSegment = createElement(ClientSegmentRoot, {
                    Component: SegmentComponent,
                    slots: parallelRouteProps,
                    serverProvidedParams: null
                });
            } else if (isStaticGeneration) {
                const promiseOfParams = createPrerenderParamsForClientSegment(currentParams);
                clientSegment = createElement(ClientSegmentRoot, {
                    Component: SegmentComponent,
                    slots: parallelRouteProps,
                    serverProvidedParams: {
                        params: currentParams,
                        promises: [
                            promiseOfParams
                        ]
                    }
                });
            } else {
                clientSegment = createElement(ClientSegmentRoot, {
                    Component: SegmentComponent,
                    slots: parallelRouteProps,
                    serverProvidedParams: {
                        params: currentParams,
                        promises: null
                    }
                });
            }
            if (isRootLayoutWithChildrenSlotAndAtLeastOneMoreSlot) {
                let notfoundClientSegment;
                let forbiddenClientSegment;
                let unauthorizedClientSegment;
                // TODO-APP: This is a hack to support unmatched parallel routes, which will throw `notFound()`.
                // This ensures that a `HTTPAccessFallbackBoundary` is available for when that happens,
                // but it's not ideal, as it needlessly invokes the `NotFound` component and renders the `RootLayout` twice.
                // We should instead look into handling the fallback behavior differently in development mode so that it doesn't
                // rely on the `NotFound` behavior.
                notfoundClientSegment = createErrorBoundaryClientSegmentRoot({
                    ctx,
                    ErrorBoundaryComponent: NotFound,
                    errorElement: notFoundElement,
                    ClientSegmentRoot,
                    layerAssets,
                    SegmentComponent,
                    currentParams
                });
                forbiddenClientSegment = createErrorBoundaryClientSegmentRoot({
                    ctx,
                    ErrorBoundaryComponent: Forbidden,
                    errorElement: forbiddenElement,
                    ClientSegmentRoot,
                    layerAssets,
                    SegmentComponent,
                    currentParams
                });
                unauthorizedClientSegment = createErrorBoundaryClientSegmentRoot({
                    ctx,
                    ErrorBoundaryComponent: Unauthorized,
                    errorElement: unauthorizedElement,
                    ClientSegmentRoot,
                    layerAssets,
                    SegmentComponent,
                    currentParams
                });
                if (notfoundClientSegment || forbiddenClientSegment || unauthorizedClientSegment) {
                    segmentNode = createElement(HTTPAccessFallbackBoundary, {
                        key: cacheNodeKey,
                        notFound: notfoundClientSegment,
                        forbidden: forbiddenClientSegment,
                        unauthorized: unauthorizedClientSegment
                    }, layerAssets, clientSegment);
                } else {
                    segmentNode = createElement(Fragment, {
                        key: cacheNodeKey
                    }, layerAssets, clientSegment);
                }
            } else {
                segmentNode = createElement(Fragment, {
                    key: cacheNodeKey
                }, layerAssets, clientSegment);
            }
        } else {
            const params = createServerParamsForServerSegment(currentParams, optionalCatchAllParamName, varyParamsAccumulator, isRuntimePrefetchable);
            let serverSegment;
            if ((0, _clientandserverreferences.isUseCacheFunction)(SegmentComponent)) {
                const UseCacheLayoutComponent = SegmentComponent;
                serverSegment = createElement(UseCacheLayoutComponent, {
                    ...parallelRouteProps,
                    params: params,
                    $$isLayout: true
                }, // Force static children here so that they're validated.
                // See https://github.com/facebook/react/pull/34846
                parallelRouteProps.children);
            } else {
                serverSegment = createElement(SegmentComponent, {
                    ...parallelRouteProps,
                    params: params
                }, // Force static children here so that they're validated.
                // See https://github.com/facebook/react/pull/34846
                parallelRouteProps.children);
            }
            if (isRootLayoutWithChildrenSlotAndAtLeastOneMoreSlot) {
                // TODO-APP: This is a hack to support unmatched parallel routes, which will throw `notFound()`.
                // This ensures that a `HTTPAccessFallbackBoundary` is available for when that happens,
                // but it's not ideal, as it needlessly invokes the `NotFound` component and renders the `RootLayout` twice.
                // We should instead look into handling the fallback behavior differently in development mode so that it doesn't
                // rely on the `NotFound` behavior.
                segmentNode = createElement(HTTPAccessFallbackBoundary, {
                    key: cacheNodeKey,
                    notFound: notFoundElement ? createElement(Fragment, null, layerAssets, createElement(SegmentComponent, {
                        params: params
                    }, notFoundStyles, notFoundElement)) : undefined
                }, layerAssets, serverSegment);
            } else {
                segmentNode = createElement(Fragment, {
                    key: cacheNodeKey
                }, layerAssets, serverSegment);
            }
        }
        const layoutFilePath = (0, _segmentexplorerpath.getConventionPathByType)(tree, dir, 'layout');
        const wrappedSegmentNode = isSegmentViewEnabled && layoutFilePath ? createElement(SegmentViewNode, {
            key: 'layout',
            type: 'layout',
            pagePath: layoutFilePath
        }, segmentNode) : segmentNode;
        // For layouts we just render the component
        return createSeedData(ctx, wrappedSegmentNode, parallelRouteCacheNodeSeedData, loadingData, isPossiblyPartialResponse, isRuntimePrefetchable, varyParamsAccumulator);
    }
}
function createErrorBoundaryClientSegmentRoot({ ctx, ErrorBoundaryComponent, errorElement, ClientSegmentRoot, layerAssets, SegmentComponent, currentParams }) {
    const { componentMod: { createElement, Fragment } } = ctx;
    if (ErrorBoundaryComponent) {
        const notFoundParallelRouteProps = {
            children: errorElement
        };
        return createElement(Fragment, null, layerAssets, createElement(ClientSegmentRoot, {
            Component: SegmentComponent,
            slots: notFoundParallelRouteProps,
            params: currentParams
        }));
    }
    return null;
}
function getRootParams(loaderTree, getDynamicParamFromSegment) {
    return getRootParamsImpl({}, loaderTree, getDynamicParamFromSegment);
}
function getRootParamsImpl(parentParams, loaderTree, getDynamicParamFromSegment) {
    const { modules: { layout }, parallelRoutes } = (0, _parseloadertree.parseLoaderTree)(loaderTree);
    const segmentParam = getDynamicParamFromSegment(loaderTree);
    let currentParams = parentParams;
    if (segmentParam && segmentParam.value !== null) {
        currentParams = {
            ...parentParams,
            [segmentParam.param]: segmentParam.value
        };
    }
    const isRootLayout = typeof layout !== 'undefined';
    if (isRootLayout) {
        return currentParams;
    } else if (!parallelRoutes.children) {
        // This should really be an error but there are bugs in Turbopack that cause
        // the _not-found LoaderTree to not have any layouts. For rootParams sake
        // this is somewhat irrelevant when you are not customizing the 404 page.
        // If you are customizing 404
        // TODO update rootParams to make all params optional if `/app/not-found.tsx` is defined
        return currentParams;
    } else {
        return getRootParamsImpl(currentParams, // We stop looking for root params as soon as we hit the first layout
        // and it is not possible to use parallel route children above the root layout
        // so every parallelRoutes object that this function can visit will necessarily
        // have a single `children` prop and no others.
        parallelRoutes.children, getDynamicParamFromSegment);
    }
}
async function createBoundaryConventionElement({ ctx, conventionName, Component, styles, tree }) {
    const { componentMod: { createElement, Fragment } } = ctx;
    const isSegmentViewEnabled = !!process.env.__NEXT_DEV_SERVER;
    const dir = (process.env.NEXT_RUNTIME === 'edge' ? process.env.__NEXT_EDGE_PROJECT_DIR : ctx.renderOpts.dir) || '';
    const { SegmentViewNode } = ctx.componentMod;
    const element = Component ? createElement(Fragment, null, createElement(Component, null), styles) : undefined;
    const pagePath = (0, _segmentexplorerpath.getConventionPathByType)(tree, dir, conventionName);
    const wrappedElement = isSegmentViewEnabled && element ? createElement(SegmentViewNode, {
        key: cacheNodeKey + '-' + conventionName,
        type: conventionName,
        // TODO: Discovered when moving to `createElement`.
        // `SegmentViewNode` doesn't support undefined `pagePath`
        pagePath: pagePath
    }, element) : element;
    return [
        wrappedElement,
        pagePath
    ];
}
function createSeedData(ctx, rsc, parallelRoutes, loading, isPossiblyPartialResponse, isRuntimePrefetchable, varyParamsAccumulator) {
    const createElement = ctx.componentMod.createElement;
    // When this segment is NOT runtime-prefetchable, delay it until the Static
    // stage by wrapping the node in a promise. This allows runtime-prefetchable
    // segments (the lower tree) to render first during EarlyStatic, so their
    // runtime data resolves in EarlyRuntime where sync IO can be checked.
    // React will suspend on the thenable and resume when the stage advances.
    if (!isRuntimePrefetchable) {
        const workUnitStore = _workunitasyncstorageexternal.workUnitAsyncStorage.getStore();
        if (workUnitStore) {
            let stagedRendering;
            switch(workUnitStore.type){
                case 'request':
                case 'prerender-runtime':
                    stagedRendering = workUnitStore.stagedRendering;
                    if (stagedRendering) {
                        const deferredRsc = rsc;
                        rsc = stagedRendering.waitForStage(_stagedrendering.RenderStage.Static).then(()=>deferredRsc);
                    }
                    break;
                case 'prerender':
                case 'prerender-client':
                case 'validation-client':
                case 'prerender-ppr':
                case 'prerender-legacy':
                case 'cache':
                case 'private-cache':
                case 'unstable-cache':
                case 'generate-static-params':
                    break;
                default:
                    workUnitStore;
            }
        }
    }
    if (loading !== null) {
        // If a loading.tsx boundary is present, wrap the component data in an
        // additional context provider to pass the loading data to the next
        // set of children.
        // NOTE: The reason this is a separate wrapper from LayoutRouter is because
        // not all segments render a LayoutRouter component, e.g. the root segment.
        const LoadingBoundaryProvider = ctx.componentMod.LoadingBoundaryProvider;
        rsc = createElement(LoadingBoundaryProvider, {
            loading: loading,
            children: rsc
        });
    }
    return [
        rsc,
        parallelRoutes,
        null,
        isPossiblyPartialResponse,
        varyParamsAccumulator ? (0, _varyparams.getVaryParamsThenable)(varyParamsAccumulator) : null
    ];
}

//# sourceMappingURL=create-component-tree.js.map