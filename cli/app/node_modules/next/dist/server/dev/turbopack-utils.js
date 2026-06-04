"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    AssetMapper: null,
    addMetadataIdToRoute: null,
    addRouteSuffix: null,
    handleEntrypoints: null,
    handlePagesErrorRoute: null,
    handleRouteType: null,
    hasEntrypointForKey: null,
    msToNs: null,
    normalizedPageToTurbopackStructureRoute: null,
    printNonFatalIssue: null,
    processTopLevelIssues: null,
    removeRouteSuffix: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    AssetMapper: function() {
        return AssetMapper;
    },
    addMetadataIdToRoute: function() {
        return addMetadataIdToRoute;
    },
    addRouteSuffix: function() {
        return addRouteSuffix;
    },
    handleEntrypoints: function() {
        return handleEntrypoints;
    },
    handlePagesErrorRoute: function() {
        return handlePagesErrorRoute;
    },
    handleRouteType: function() {
        return handleRouteType;
    },
    hasEntrypointForKey: function() {
        return hasEntrypointForKey;
    },
    msToNs: function() {
        return _compilationevents.msToNs;
    },
    normalizedPageToTurbopackStructureRoute: function() {
        return normalizedPageToTurbopackStructureRoute;
    },
    printNonFatalIssue: function() {
        return printNonFatalIssue;
    },
    processTopLevelIssues: function() {
        return processTopLevelIssues;
    },
    removeRouteSuffix: function() {
        return removeRouteSuffix;
    }
});
const _hotreloadertypes = require("./hot-reloader-types");
const _log = /*#__PURE__*/ _interop_require_wildcard(require("../../build/output/log"));
const _entrykey = require("../../shared/lib/turbopack/entry-key");
const _ismetadataroute = require("../../lib/metadata/is-metadata-route");
const _utils = require("../../shared/lib/turbopack/utils");
const _constants = require("../../lib/constants");
const _compilationevents = require("../../shared/lib/turbopack/compilation-events");
function _getRequireWildcardCache(nodeInterop) {
    if (typeof WeakMap !== "function") return null;
    var cacheBabelInterop = new WeakMap();
    var cacheNodeInterop = new WeakMap();
    return (_getRequireWildcardCache = function(nodeInterop) {
        return nodeInterop ? cacheNodeInterop : cacheBabelInterop;
    })(nodeInterop);
}
function _interop_require_wildcard(obj, nodeInterop) {
    if (!nodeInterop && obj && obj.__esModule) {
        return obj;
    }
    if (obj === null || typeof obj !== "object" && typeof obj !== "function") {
        return {
            default: obj
        };
    }
    var cache = _getRequireWildcardCache(nodeInterop);
    if (cache && cache.has(obj)) {
        return cache.get(obj);
    }
    var newObj = {
        __proto__: null
    };
    var hasPropertyDescriptor = Object.defineProperty && Object.getOwnPropertyDescriptor;
    for(var key in obj){
        if (key !== "default" && Object.prototype.hasOwnProperty.call(obj, key)) {
            var desc = hasPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : null;
            if (desc && (desc.get || desc.set)) {
                Object.defineProperty(newObj, key, desc);
            } else {
                newObj[key] = obj[key];
            }
        }
    }
    newObj.default = obj;
    if (cache) {
        cache.set(obj, newObj);
    }
    return newObj;
}
const onceErrorSet = new Set();
/**
 * Check if given issue is a warning to be display only once.
 * This mimics behavior of get-page-static-info's warnOnce.
 * @param issue
 * @returns
 */ function shouldEmitOnceWarning(issue) {
    const { severity, title, stage } = issue;
    if (severity === 'warning' && title.value === 'Invalid page configuration') {
        if (onceErrorSet.has(issue)) {
            return false;
        }
        onceErrorSet.add(issue);
    }
    if (severity === 'warning' && stage === 'config' && (0, _utils.renderStyledStringToErrorAnsi)(issue.title).includes("can't be external")) {
        if (onceErrorSet.has(issue)) {
            return false;
        }
        onceErrorSet.add(issue);
    }
    return true;
}
function printNonFatalIssue(issue) {
    if ((0, _utils.isRelevantWarning)(issue) && shouldEmitOnceWarning(issue)) {
        _log.warn((0, _utils.formatIssue)(issue));
    }
}
function processTopLevelIssues(currentTopLevelIssues, result) {
    currentTopLevelIssues.clear();
    for (const issue of result.issues){
        const issueKey = (0, _utils.getIssueKey)(issue);
        currentTopLevelIssues.set(issueKey, issue);
    }
}
async function handleRouteType({ dev, page, pathname, route, currentEntryIssues, entrypoints, manifestLoader, readyIds, devRewrites, productionRewrites, hooks, logErrors }) {
    switch(route.type){
        case 'page':
            {
                const clientKey = (0, _entrykey.getEntryKey)('pages', 'client', page);
                const serverKey = (0, _entrykey.getEntryKey)('pages', 'server', page);
                try {
                    // In the best case scenario, Turbopack chunks document, app, page separately in that order,
                    // so it can happen that the chunks of document change, but the chunks of app and page
                    // don't. We still need to reload the page chunks in that case though, otherwise the version
                    // of the document or app component export from the pages template is stale.
                    let documentOrAppChanged = false;
                    if (entrypoints.global.app) {
                        const key = (0, _entrykey.getEntryKey)('pages', 'server', '_app');
                        const writtenEndpoint = await entrypoints.global.app.writeToDisk();
                        documentOrAppChanged ||= (hooks == null ? void 0 : hooks.handleWrittenEndpoint(key, writtenEndpoint, false)) ?? false;
                        (0, _utils.processIssues)(currentEntryIssues, key, writtenEndpoint, false, logErrors);
                    }
                    await manifestLoader.loadBuildManifest('_app');
                    await manifestLoader.loadPagesManifest('_app');
                    if (entrypoints.global.document) {
                        const key = (0, _entrykey.getEntryKey)('pages', 'server', '_document');
                        const writtenEndpoint = await entrypoints.global.document.writeToDisk();
                        documentOrAppChanged ||= (hooks == null ? void 0 : hooks.handleWrittenEndpoint(key, writtenEndpoint, false)) ?? false;
                        (0, _utils.processIssues)(currentEntryIssues, key, writtenEndpoint, false, logErrors);
                    }
                    await manifestLoader.loadPagesManifest('_document');
                    const writtenEndpoint = await route.htmlEndpoint.writeToDisk();
                    hooks == null ? void 0 : hooks.handleWrittenEndpoint(serverKey, writtenEndpoint, documentOrAppChanged);
                    const type = writtenEndpoint == null ? void 0 : writtenEndpoint.type;
                    await manifestLoader.loadClientBuildManifest(page);
                    await manifestLoader.loadBuildManifest(page);
                    await manifestLoader.loadPagesManifest(page);
                    if (type === 'edge') {
                        await manifestLoader.loadMiddlewareManifest(page, 'pages');
                    } else {
                        manifestLoader.deleteMiddlewareManifest(serverKey);
                    }
                    await manifestLoader.loadFontManifest('/_app', 'pages');
                    await manifestLoader.loadFontManifest(page, 'pages');
                    manifestLoader.writeManifests({
                        devRewrites,
                        productionRewrites,
                        entrypoints
                    });
                    (0, _utils.processIssues)(currentEntryIssues, serverKey, writtenEndpoint, false, logErrors);
                } finally{
                    if (dev) {
                        // TODO subscriptions should only be caused by the WebSocket connections
                        // otherwise we don't known when to unsubscribe and this leaking
                        hooks == null ? void 0 : hooks.subscribeToChanges(serverKey, false, route.dataEndpoint, ()=>{
                            // Report the next compilation again
                            readyIds == null ? void 0 : readyIds.delete(pathname);
                            return {
                                type: _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.SERVER_ONLY_CHANGES,
                                pages: [
                                    page
                                ]
                            };
                        }, (e)=>{
                            return {
                                type: _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.RELOAD_PAGE,
                                data: `error in ${page} data subscription: ${e}`
                            };
                        });
                        hooks == null ? void 0 : hooks.subscribeToChanges(clientKey, false, route.htmlEndpoint, ()=>{
                            return {
                                type: _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.CLIENT_CHANGES
                            };
                        }, (e)=>{
                            return {
                                type: _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.RELOAD_PAGE,
                                data: `error in ${page} html subscription: ${e}`
                            };
                        });
                        if (entrypoints.global.document) {
                            hooks == null ? void 0 : hooks.subscribeToChanges((0, _entrykey.getEntryKey)('pages', 'server', '_document'), false, entrypoints.global.document, ()=>{
                                return {
                                    type: _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.RELOAD_PAGE,
                                    data: '_document has changed (page route)'
                                };
                            }, (e)=>{
                                return {
                                    type: _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.RELOAD_PAGE,
                                    data: `error in _document subscription (page route): ${e}`
                                };
                            });
                        }
                    }
                }
                break;
            }
        case 'page-api':
            {
                const key = (0, _entrykey.getEntryKey)('pages', 'server', page);
                const writtenEndpoint = await route.endpoint.writeToDisk();
                hooks == null ? void 0 : hooks.handleWrittenEndpoint(key, writtenEndpoint, false);
                const type = writtenEndpoint.type;
                await manifestLoader.loadPagesManifest(page);
                if (type === 'edge') {
                    await manifestLoader.loadMiddlewareManifest(page, 'pages');
                } else {
                    manifestLoader.deleteMiddlewareManifest(key);
                }
                manifestLoader.writeManifests({
                    devRewrites,
                    productionRewrites,
                    entrypoints
                });
                (0, _utils.processIssues)(currentEntryIssues, key, writtenEndpoint, true, logErrors);
                break;
            }
        case 'app-page':
            {
                const key = (0, _entrykey.getEntryKey)('app', 'server', page);
                const writtenEndpoint = await route.htmlEndpoint.writeToDisk();
                hooks == null ? void 0 : hooks.handleWrittenEndpoint(key, writtenEndpoint, false);
                if (dev) {
                    // TODO subscriptions should only be caused by the WebSocket connections
                    // otherwise we don't known when to unsubscribe and this leaking
                    hooks == null ? void 0 : hooks.subscribeToChanges(key, true, route.rscEndpoint, (change, hash)=>{
                        if (change.issues.some((issue)=>issue.severity === 'error')) {
                            // Ignore any updates that has errors
                            // There will be another update without errors eventually
                            return;
                        }
                        // Report the next compilation again
                        readyIds == null ? void 0 : readyIds.delete(pathname);
                        return {
                            type: _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.SERVER_COMPONENT_CHANGES,
                            hash
                        };
                    }, (e)=>{
                        return {
                            type: _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.RELOAD_PAGE,
                            data: `error in ${page} app-page subscription: ${e}`
                        };
                    });
                }
                const type = writtenEndpoint.type;
                if (type === 'edge') {
                    manifestLoader.loadMiddlewareManifest(page, 'app');
                } else {
                    manifestLoader.deleteMiddlewareManifest(key);
                }
                manifestLoader.loadBuildManifest(page, 'app');
                manifestLoader.loadAppPathsManifest(page);
                manifestLoader.loadActionManifest(page);
                manifestLoader.loadFontManifest(page, 'app');
                manifestLoader.writeManifests({
                    devRewrites,
                    productionRewrites,
                    entrypoints
                });
                (0, _utils.processIssues)(currentEntryIssues, key, writtenEndpoint, dev, logErrors);
                break;
            }
        case 'app-route':
            {
                const key = (0, _entrykey.getEntryKey)('app', 'server', page);
                const writtenEndpoint = await route.endpoint.writeToDisk();
                hooks == null ? void 0 : hooks.handleWrittenEndpoint(key, writtenEndpoint, false);
                const type = writtenEndpoint.type;
                manifestLoader.loadAppPathsManifest(page);
                if (type === 'edge') {
                    manifestLoader.loadMiddlewareManifest(page, 'app');
                } else {
                    manifestLoader.deleteMiddlewareManifest(key);
                }
                manifestLoader.writeManifests({
                    devRewrites,
                    productionRewrites,
                    entrypoints
                });
                (0, _utils.processIssues)(currentEntryIssues, key, writtenEndpoint, true, logErrors);
                break;
            }
        default:
            {
                throw Object.defineProperty(new Error(`unknown route type ${route.type} for ${page}`), "__NEXT_ERROR_CODE", {
                    value: "E316",
                    enumerable: false,
                    configurable: true
                });
            }
    }
}
class AssetMapper {
    /**
   * Overrides asset paths for a key and updates the mapping from path to key.
   *
   * @param key
   * @param assetPaths asset paths relative to the .next directory
   */ setPathsForKey(key, assetPaths) {
        this.delete(key);
        const newAssetPaths = new Set(assetPaths);
        this.entryMap.set(key, newAssetPaths);
        for (const assetPath of newAssetPaths){
            let assetPathKeys = this.assetMap.get(assetPath);
            if (!assetPathKeys) {
                assetPathKeys = new Set();
                this.assetMap.set(assetPath, assetPathKeys);
            }
            assetPathKeys.add(key);
        }
    }
    /**
   * Deletes the key and any asset only referenced by this key.
   *
   * @param key
   */ delete(key) {
        for (const assetPath of this.getAssetPathsByKey(key)){
            const assetPathKeys = this.assetMap.get(assetPath);
            assetPathKeys == null ? void 0 : assetPathKeys.delete(key);
            if (!(assetPathKeys == null ? void 0 : assetPathKeys.size)) {
                this.assetMap.delete(assetPath);
            }
        }
        this.entryMap.delete(key);
    }
    getAssetPathsByKey(key) {
        return Array.from(this.entryMap.get(key) ?? []);
    }
    getKeysByAsset(path) {
        return Array.from(this.assetMap.get(path) ?? []);
    }
    keys() {
        return this.entryMap.keys();
    }
    constructor(){
        this.entryMap = new Map();
        this.assetMap = new Map();
    }
}
function hasEntrypointForKey(entrypoints, key, assetMapper) {
    const { type, page } = (0, _entrykey.splitEntryKey)(key);
    switch(type){
        case 'app':
            return entrypoints.app.has(page);
        case 'pages':
            switch(page){
                case '_app':
                    return entrypoints.global.app != null;
                case '_document':
                    return entrypoints.global.document != null;
                case '_error':
                    return entrypoints.global.error != null;
                default:
                    return entrypoints.page.has(page);
            }
        case 'root':
            switch(page){
                case 'middleware':
                    return entrypoints.global.middleware != null;
                case 'instrumentation':
                    return entrypoints.global.instrumentation != null;
                default:
                    return false;
            }
        case 'assets':
            if (!assetMapper) {
                return false;
            }
            return assetMapper.getKeysByAsset(page).some((pageKey)=>hasEntrypointForKey(entrypoints, pageKey, assetMapper));
        default:
            {
                // validation that we covered all cases, this should never run.
                const _ = type;
                return false;
            }
    }
}
async function handleEntrypoints({ entrypoints, currentEntrypoints, currentEntryIssues, manifestLoader, devRewrites, logErrors, dev }) {
    currentEntrypoints.global.app = entrypoints.pagesAppEndpoint;
    currentEntrypoints.global.document = entrypoints.pagesDocumentEndpoint;
    currentEntrypoints.global.error = entrypoints.pagesErrorEndpoint;
    currentEntrypoints.global.instrumentation = entrypoints.instrumentation;
    currentEntrypoints.page.clear();
    currentEntrypoints.app.clear();
    for (const [pathname, route] of entrypoints.routes){
        switch(route.type){
            case 'page':
            case 'page-api':
                currentEntrypoints.page.set(pathname, route);
                break;
            case 'app-page':
                {
                    route.pages.forEach((page)=>{
                        currentEntrypoints.app.set(page.originalName, {
                            type: 'app-page',
                            ...page
                        });
                    });
                    break;
                }
            case 'app-route':
                {
                    currentEntrypoints.app.set(route.originalName, route);
                    break;
                }
            case 'conflict':
                _log.info(`skipping ${pathname} (${route.type})`);
                break;
            default:
                route;
        }
    }
    if (dev) {
        await handleEntrypointsDevCleanup({
            currentEntryIssues,
            currentEntrypoints,
            ...dev
        });
    }
    const { middleware, instrumentation } = entrypoints;
    // We check for explicit true/false, since it's initialized to
    // undefined during the first loop (middlewareChanges event is
    // unnecessary during the first serve)
    if (currentEntrypoints.global.middleware && !middleware) {
        const key = (0, _entrykey.getEntryKey)('root', 'server', 'middleware');
        // Went from middleware to no middleware
        await (dev == null ? void 0 : dev.hooks.unsubscribeFromChanges(key));
        currentEntryIssues.delete(key);
        dev.hooks.sendHmr('middleware', {
            type: _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.MIDDLEWARE_CHANGES
        });
    } else if (!currentEntrypoints.global.middleware && middleware) {
        // Went from no middleware to middleware
        dev.hooks.sendHmr('middleware', {
            type: _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.MIDDLEWARE_CHANGES
        });
    }
    currentEntrypoints.global.middleware = middleware;
    if (instrumentation) {
        const processInstrumentation = async (name, prop)=>{
            const prettyName = {
                nodeJs: 'Node.js',
                edge: 'Edge'
            };
            const finishBuilding = dev.hooks.startBuilding(`instrumentation ${prettyName[prop]}`, undefined, true);
            const key = (0, _entrykey.getEntryKey)('root', 'server', name);
            const writtenEndpoint = await instrumentation[prop].writeToDisk();
            dev.hooks.handleWrittenEndpoint(key, writtenEndpoint, false);
            (0, _utils.processIssues)(currentEntryIssues, key, writtenEndpoint, false, logErrors);
            finishBuilding();
        };
        await processInstrumentation('instrumentation.nodeJs', 'nodeJs');
        await processInstrumentation('instrumentation.edge', 'edge');
        await manifestLoader.loadMiddlewareManifest('instrumentation', 'instrumentation');
        manifestLoader.writeManifests({
            devRewrites,
            productionRewrites: undefined,
            entrypoints: currentEntrypoints
        });
        dev.serverFields.actualInstrumentationHookFile = '/instrumentation';
        await dev.hooks.propagateServerField('actualInstrumentationHookFile', dev.serverFields.actualInstrumentationHookFile);
    } else {
        dev.serverFields.actualInstrumentationHookFile = undefined;
        await dev.hooks.propagateServerField('actualInstrumentationHookFile', dev.serverFields.actualInstrumentationHookFile);
    }
    if (middleware) {
        const key = (0, _entrykey.getEntryKey)('root', 'server', 'middleware');
        const endpoint = middleware.endpoint;
        const triggerName = middleware.isProxy ? _constants.PROXY_FILENAME : _constants.MIDDLEWARE_FILENAME;
        async function processMiddleware() {
            var _manifestLoader_getMiddlewareManifest;
            const finishBuilding = dev.hooks.startBuilding(triggerName, undefined, true);
            const writtenEndpoint = await endpoint.writeToDisk();
            dev.hooks.handleWrittenEndpoint(key, writtenEndpoint, false);
            (0, _utils.processIssues)(currentEntryIssues, key, writtenEndpoint, false, logErrors);
            await manifestLoader.loadMiddlewareManifest('middleware', 'middleware');
            const middlewareConfig = (_manifestLoader_getMiddlewareManifest = manifestLoader.getMiddlewareManifest(key)) == null ? void 0 : _manifestLoader_getMiddlewareManifest.middleware['/'];
            if (dev && middlewareConfig) {
                dev.serverFields.middleware = {
                    match: null,
                    page: '/',
                    matchers: middlewareConfig.matchers
                };
            }
            finishBuilding();
        }
        await processMiddleware();
        if (dev) {
            dev == null ? void 0 : dev.hooks.subscribeToChanges(key, false, endpoint, async ()=>{
                const finishBuilding = dev.hooks.startBuilding(triggerName, undefined, true);
                await processMiddleware();
                await dev.hooks.propagateServerField('actualMiddlewareFile', dev.serverFields.actualMiddlewareFile);
                await dev.hooks.propagateServerField('middleware', dev.serverFields.middleware);
                manifestLoader.writeManifests({
                    devRewrites,
                    productionRewrites: undefined,
                    entrypoints: currentEntrypoints
                });
                finishBuilding == null ? void 0 : finishBuilding();
                return {
                    type: _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.MIDDLEWARE_CHANGES
                };
            }, ()=>{
                return {
                    type: _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.MIDDLEWARE_CHANGES
                };
            });
        }
    } else {
        manifestLoader.deleteMiddlewareManifest((0, _entrykey.getEntryKey)('root', 'server', 'middleware'));
        dev.serverFields.actualMiddlewareFile = undefined;
        dev.serverFields.middleware = undefined;
    }
    await dev.hooks.propagateServerField('actualMiddlewareFile', dev.serverFields.actualMiddlewareFile);
    await dev.hooks.propagateServerField('middleware', dev.serverFields.middleware);
}
async function handleEntrypointsDevCleanup({ currentEntryIssues, currentEntrypoints, assetMapper, changeSubscriptions, clients, clientStates, hooks }) {
    // this needs to be first as `hasEntrypointForKey` uses the `assetMapper`
    for (const key of assetMapper.keys()){
        if (!hasEntrypointForKey(currentEntrypoints, key, assetMapper)) {
            assetMapper.delete(key);
        }
    }
    for (const key of changeSubscriptions.keys()){
        // middleware is handled separately
        if (!hasEntrypointForKey(currentEntrypoints, key, assetMapper)) {
            await hooks.unsubscribeFromChanges(key);
        }
    }
    for (const [key] of currentEntryIssues){
        if (!hasEntrypointForKey(currentEntrypoints, key, assetMapper)) {
            currentEntryIssues.delete(key);
        }
    }
    for (const client of clients){
        const state = clientStates.get(client);
        if (!state) {
            continue;
        }
        for (const key of state.clientIssues.keys()){
            if (!hasEntrypointForKey(currentEntrypoints, key, assetMapper)) {
                state.clientIssues.delete(key);
            }
        }
        for (const id of state.subscriptions.keys()){
            if (!hasEntrypointForKey(currentEntrypoints, (0, _entrykey.getEntryKey)('assets', 'client', id), assetMapper)) {
                hooks.unsubscribeFromHmrEvents(client, id);
            }
        }
    }
}
async function handlePagesErrorRoute({ currentEntryIssues, entrypoints, manifestLoader, devRewrites, productionRewrites, logErrors, hooks }) {
    if (entrypoints.global.app) {
        const key = (0, _entrykey.getEntryKey)('pages', 'server', '_app');
        const writtenEndpoint = await entrypoints.global.app.writeToDisk();
        hooks.handleWrittenEndpoint(key, writtenEndpoint, false);
        hooks.subscribeToChanges(key, false, entrypoints.global.app, ()=>{
            // There's a special case for this in `../client/page-bootstrap.ts`.
            // https://github.com/vercel/next.js/blob/08d7a7e5189a835f5dcb82af026174e587575c0e/packages/next/src/client/page-bootstrap.ts#L69-L71
            return {
                type: _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.CLIENT_CHANGES
            };
        }, ()=>{
            return {
                type: _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.RELOAD_PAGE,
                data: '_app has changed (error route)'
            };
        });
        (0, _utils.processIssues)(currentEntryIssues, key, writtenEndpoint, false, logErrors);
    }
    await manifestLoader.loadBuildManifest('_app');
    await manifestLoader.loadPagesManifest('_app');
    await manifestLoader.loadFontManifest('_app');
    if (entrypoints.global.document) {
        const key = (0, _entrykey.getEntryKey)('pages', 'server', '_document');
        const writtenEndpoint = await entrypoints.global.document.writeToDisk();
        hooks.handleWrittenEndpoint(key, writtenEndpoint, false);
        hooks.subscribeToChanges(key, false, entrypoints.global.document, ()=>{
            return {
                type: _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.RELOAD_PAGE,
                data: '_document has changed (error route)'
            };
        }, (e)=>{
            return {
                type: _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.RELOAD_PAGE,
                data: `error in _document subscription (error route): ${e}`
            };
        });
        (0, _utils.processIssues)(currentEntryIssues, key, writtenEndpoint, false, logErrors);
    }
    await manifestLoader.loadPagesManifest('_document');
    if (entrypoints.global.error) {
        const key = (0, _entrykey.getEntryKey)('pages', 'server', '_error');
        const writtenEndpoint = await entrypoints.global.error.writeToDisk();
        hooks.handleWrittenEndpoint(key, writtenEndpoint, false);
        hooks.subscribeToChanges(key, false, entrypoints.global.error, ()=>{
            // There's a special case for this in `../client/page-bootstrap.ts`.
            // https://github.com/vercel/next.js/blob/08d7a7e5189a835f5dcb82af026174e587575c0e/packages/next/src/client/page-bootstrap.ts#L69-L71
            return {
                type: _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.CLIENT_CHANGES
            };
        }, (e)=>{
            return {
                type: _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.RELOAD_PAGE,
                data: `error in _error subscription: ${e}`
            };
        });
        (0, _utils.processIssues)(currentEntryIssues, key, writtenEndpoint, false, logErrors);
    }
    await manifestLoader.loadClientBuildManifest('_error');
    await manifestLoader.loadBuildManifest('_error');
    await manifestLoader.loadPagesManifest('_error');
    await manifestLoader.loadFontManifest('_error');
    manifestLoader.writeManifests({
        devRewrites,
        productionRewrites,
        entrypoints
    });
}
function removeRouteSuffix(route) {
    return route.replace(/\/route$/, '');
}
function addRouteSuffix(route) {
    return route + '/route';
}
function addMetadataIdToRoute(route) {
    return route + '/[__metadata_id__]';
}
function normalizedPageToTurbopackStructureRoute(route, ext) {
    let entrypointKey = route;
    if ((0, _ismetadataroute.isMetadataRoute)(entrypointKey)) {
        entrypointKey = entrypointKey.endsWith('/route') ? entrypointKey.slice(0, -'/route'.length) : entrypointKey;
        if (ext) {
            if (entrypointKey.endsWith('/[__metadata_id__]')) {
                entrypointKey = entrypointKey.slice(0, -'/[__metadata_id__]'.length);
            }
            // After stripping [__metadata_id__], add .xml for dynamic sitemap routes
            // to match the Turbopack entry key from normalize_metadata_route
            if (entrypointKey.endsWith('/sitemap') && ext !== '.xml') {
                entrypointKey = entrypointKey + '.xml';
            }
        }
        entrypointKey = entrypointKey + '/route';
    }
    return entrypointKey;
}

//# sourceMappingURL=turbopack-utils.js.map