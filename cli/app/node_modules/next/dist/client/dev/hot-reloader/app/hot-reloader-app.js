/// <reference types="webpack/module.d.ts" />
"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    default: null,
    performFullReload: null,
    processMessage: null,
    waitForWebpackRuntimeHotUpdate: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    default: function() {
        return HotReload;
    },
    performFullReload: function() {
        return performFullReload;
    },
    processMessage: function() {
        return processMessage;
    },
    waitForWebpackRuntimeHotUpdate: function() {
        return waitForWebpackRuntimeHotUpdate;
    }
});
const _interop_require_default = require("@swc/helpers/_/_interop_require_default");
const _jsxruntime = require("react/jsx-runtime");
const _react = require("react");
const _stripansi = /*#__PURE__*/ _interop_require_default._(require("next/dist/compiled/strip-ansi"));
const _formatwebpackmessages = /*#__PURE__*/ _interop_require_default._(require("../../../../shared/lib/format-webpack-messages"));
const _shared = require("../shared");
const _nextdevtools = require("next/dist/compiled/next-devtools");
const _replayssronlyerrors = require("../../../../next-devtools/userspace/app/errors/replay-ssr-only-errors");
const _appdevoverlayerrorboundary = require("../../../../next-devtools/userspace/app/app-dev-overlay-error-boundary");
const _useerrorhandler = require("../../../../next-devtools/userspace/app/errors/use-error-handler");
const _runtimeerrorhandler = require("../../runtime-error-handler");
const _websocket = require("./web-socket");
const _hotreloadertypes = require("../../../../server/dev/hot-reloader-types");
const _navigationuntracked = require("../../../components/navigation-untracked");
const _reporthmrlatency = /*#__PURE__*/ _interop_require_default._(require("../../report-hmr-latency"));
const _turbopackhotreloadercommon = require("../turbopack-hot-reloader-common");
const _approuterheaders = require("../../../components/app-router-headers");
const _approuterinstance = require("../../../components/app-router-instance");
const _invarianterror = require("../../../../shared/lib/invariant-error");
const _debugchannel = require("../../debug-channel");
const _client = require("react-server-dom-webpack/client");
const _appfindsourcemapurl = require("../../../app-find-source-map-url");
const createFromReadableStream = _client.createFromReadableStream;
let mostRecentCompilationHash = null;
let __nextDevClientId = Math.round(Math.random() * 100 + Date.now());
let reloading = false;
let webpackStartMsSinceEpoch = null;
const turbopackHmr = process.env.TURBOPACK ? new _turbopackhotreloadercommon.TurbopackHmr() : null;
let pendingHotUpdateWebpack = Promise.resolve();
let resolvePendingHotUpdateWebpack = ()=>{};
function setPendingHotUpdateWebpack() {
    pendingHotUpdateWebpack = new Promise((resolve)=>{
        resolvePendingHotUpdateWebpack = ()=>{
            resolve();
        };
    });
}
function waitForWebpackRuntimeHotUpdate() {
    return pendingHotUpdateWebpack;
}
// There is a newer version of the code available.
function handleAvailableHash(hash) {
    // Update last known compilation hash.
    mostRecentCompilationHash = hash;
}
/**
 * Is there a newer version of this code available?
 * For webpack: Check if the hash changed compared to __webpack_hash__
 * For Turbopack: Always true because it doesn't have __webpack_hash__
 */ function isUpdateAvailable() {
    if (process.env.TURBOPACK) {
        return true;
    }
    /* globals __webpack_hash__ */ // __webpack_hash__ is the hash of the current compilation.
    // It's a global variable injected by Webpack.
    return mostRecentCompilationHash !== __webpack_hash__;
}
// Webpack disallows updates in other states.
function canApplyUpdates() {
    return module.hot.status() === 'idle';
}
function afterApplyUpdates(fn) {
    if (canApplyUpdates()) {
        fn();
    } else {
        function handler(status) {
            if (status === 'idle') {
                module.hot.removeStatusHandler(handler);
                fn();
            }
        }
        module.hot.addStatusHandler(handler);
    }
}
function performFullReload(err, sendMessage) {
    const stackTrace = err && (err.stack && err.stack.split('\n').slice(0, 5).join('\n') || err.message || err + '');
    sendMessage(JSON.stringify({
        event: 'client-full-reload',
        stackTrace,
        hadRuntimeError: !!_runtimeerrorhandler.RuntimeErrorHandler.hadRuntimeError,
        dependencyChain: err ? err.dependencyChain : undefined
    }));
    if (reloading) return;
    reloading = true;
    window.location.reload();
}
// Attempt to update code on the fly, fall back to a hard reload.
function tryApplyUpdatesWebpack(sendMessage) {
    if (!isUpdateAvailable() || !canApplyUpdates()) {
        resolvePendingHotUpdateWebpack();
        _nextdevtools.dispatcher.onBuildOk();
        (0, _reporthmrlatency.default)(sendMessage, [], webpackStartMsSinceEpoch, Date.now());
        return;
    }
    function handleApplyUpdates(err, updatedModules) {
        if (err || _runtimeerrorhandler.RuntimeErrorHandler.hadRuntimeError || updatedModules == null) {
            if (err) {
                console.warn(_shared.REACT_REFRESH_FULL_RELOAD);
            } else if (_runtimeerrorhandler.RuntimeErrorHandler.hadRuntimeError) {
                console.warn(_shared.REACT_REFRESH_FULL_RELOAD_FROM_ERROR);
            }
            performFullReload(err, sendMessage);
            return;
        }
        _nextdevtools.dispatcher.onBuildOk();
        if (isUpdateAvailable()) {
            // While we were updating, there was a new update! Do it again.
            tryApplyUpdatesWebpack(sendMessage);
            return;
        }
        _nextdevtools.dispatcher.onRefresh();
        resolvePendingHotUpdateWebpack();
        (0, _reporthmrlatency.default)(sendMessage, updatedModules, webpackStartMsSinceEpoch, Date.now());
        if (process.env.__NEXT_TEST_MODE) {
            afterApplyUpdates(()=>{
                if (self.__NEXT_HMR_CB) {
                    self.__NEXT_HMR_CB();
                    self.__NEXT_HMR_CB = null;
                }
            });
        }
    }
    // https://webpack.js.org/api/hot-module-replacement/#check
    module.hot.check(/* autoApply */ false).then((updatedModules)=>{
        if (updatedModules == null) {
            return null;
        }
        // We should always handle an update, even if updatedModules is empty (but
        // non-null) for any reason. That's what webpack would normally do:
        // https://github.com/webpack/webpack/blob/3aa6b6bc3a64/lib/hmr/HotModuleReplacement.runtime.js#L296-L298
        _nextdevtools.dispatcher.onBeforeRefresh();
        // https://webpack.js.org/api/hot-module-replacement/#apply
        return module.hot.apply();
    }).then((updatedModules)=>{
        handleApplyUpdates(null, updatedModules);
    }, (err)=>{
        handleApplyUpdates(err, null);
    });
}
function processMessage(message, sendMessage, processTurbopackMessage, staticIndicatorState) {
    function handleErrors(errors) {
        // "Massage" webpack messages.
        const formatted = (0, _formatwebpackmessages.default)({
            errors: errors,
            warnings: []
        });
        // Only show the first error.
        _nextdevtools.dispatcher.onBuildError(formatted.errors[0]);
        // Also log them to the console.
        for(let i = 0; i < formatted.errors.length; i++){
            console.error((0, _stripansi.default)(formatted.errors[i]));
        }
        // Do not attempt to reload now.
        // We will reload on next success instead.
        if (process.env.__NEXT_TEST_MODE) {
            if (self.__NEXT_HMR_CB) {
                self.__NEXT_HMR_CB(formatted.errors[0]);
                self.__NEXT_HMR_CB = null;
            }
        }
    }
    function handleHotUpdate() {
        if (process.env.TURBOPACK) {
            const hmrUpdate = turbopackHmr.onBuilt();
            if (hmrUpdate != null) {
                (0, _reporthmrlatency.default)(sendMessage, [
                    ...hmrUpdate.updatedModules
                ], hmrUpdate.startMsSinceEpoch, hmrUpdate.endMsSinceEpoch, // suppress the `client-hmr-latency` event if the update was a no-op:
                hmrUpdate.hasUpdates);
            }
            _nextdevtools.dispatcher.onBuildOk();
        } else {
            tryApplyUpdatesWebpack(sendMessage);
        }
    }
    switch(message.type){
        case _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.ISR_MANIFEST:
            {
                if (process.env.__NEXT_DEV_INDICATOR) {
                    staticIndicatorState.appIsrManifest = message.data;
                    // Handle the initial static indicator status on receiving the ISR
                    // manifest. Navigation is handled in an effect inside HotReload for
                    // pathname changes as we'll receive the updated manifest before
                    // usePathname triggers for a new value.
                    const isStatic = staticIndicatorState.pathname ? message.data[staticIndicatorState.pathname] : undefined;
                    _nextdevtools.dispatcher.onStaticIndicator(isStatic === undefined ? 'pending' : isStatic ? 'static' : 'dynamic');
                }
                break;
            }
        case _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.BUILDING:
            {
                _nextdevtools.dispatcher.buildingIndicatorShow();
                if (process.env.TURBOPACK) {
                    turbopackHmr.onBuilding();
                } else {
                    webpackStartMsSinceEpoch = Date.now();
                    setPendingHotUpdateWebpack();
                    console.log('[Fast Refresh] rebuilding');
                }
                break;
            }
        case _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.BUILT:
        case _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.SYNC:
            {
                _nextdevtools.dispatcher.buildingIndicatorHide();
                if (message.hash) {
                    handleAvailableHash(message.hash);
                }
                const { errors, warnings } = message;
                // Is undefined when it's a 'built' event
                if ('versionInfo' in message) _nextdevtools.dispatcher.onVersionInfo(message.versionInfo);
                if ('debug' in message && message.debug) _nextdevtools.dispatcher.onDebugInfo(message.debug);
                if ('devIndicator' in message) _nextdevtools.dispatcher.onDevIndicator(message.devIndicator);
                if ('devToolsConfig' in message) _nextdevtools.dispatcher.onDevToolsConfig(message.devToolsConfig);
                const hasErrors = Boolean(errors && errors.length);
                // Compilation with errors (e.g. syntax error or missing modules).
                if (hasErrors) {
                    sendMessage(JSON.stringify({
                        event: 'client-error',
                        errorCount: errors.length,
                        clientId: __nextDevClientId
                    }));
                    handleErrors(errors);
                    return;
                }
                const hasWarnings = Boolean(warnings && warnings.length);
                if (hasWarnings) {
                    sendMessage(JSON.stringify({
                        event: 'client-warning',
                        warningCount: warnings.length,
                        clientId: __nextDevClientId
                    }));
                    // Print warnings to the console.
                    const formattedMessages = (0, _formatwebpackmessages.default)({
                        warnings: warnings,
                        errors: []
                    });
                    for(let i = 0; i < formattedMessages.warnings.length; i++){
                        if (i === 5) {
                            console.warn('There were more warnings in other files.\n' + 'You can find a complete log in the terminal.');
                            break;
                        }
                        console.warn((0, _stripansi.default)(formattedMessages.warnings[i]));
                    }
                // No early return here as we need to apply modules in the same way between warnings only and compiles without warnings
                }
                sendMessage(JSON.stringify({
                    event: 'client-success',
                    clientId: __nextDevClientId
                }));
                if (message.type === _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.BUILT) {
                    handleHotUpdate();
                }
                return;
            }
        case _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.TURBOPACK_CONNECTED:
            {
                processTurbopackMessage({
                    type: _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.TURBOPACK_CONNECTED,
                    data: {
                        sessionId: message.data.sessionId
                    }
                });
                break;
            }
        case _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.TURBOPACK_MESSAGE:
            {
                turbopackHmr.onTurbopackMessage(message);
                _nextdevtools.dispatcher.onBeforeRefresh();
                processTurbopackMessage({
                    type: _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.TURBOPACK_MESSAGE,
                    data: message.data
                });
                if (_runtimeerrorhandler.RuntimeErrorHandler.hadRuntimeError) {
                    console.warn(_shared.REACT_REFRESH_FULL_RELOAD_FROM_ERROR);
                    performFullReload(null, sendMessage);
                }
                _nextdevtools.dispatcher.onRefresh();
                break;
            }
        // TODO-APP: make server component change more granular
        case _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.SERVER_COMPONENT_CHANGES:
            {
                turbopackHmr?.onServerComponentChanges();
                sendMessage(JSON.stringify({
                    event: 'server-component-reload-page',
                    clientId: __nextDevClientId,
                    hash: message.hash
                }));
                // Store the latest hash in a session cookie so that it's sent back to the
                // server with any subsequent requests.
                document.cookie = `${_approuterheaders.NEXT_HMR_REFRESH_HASH_COOKIE}=${message.hash};path=/`;
                if (_runtimeerrorhandler.RuntimeErrorHandler.hadRuntimeError || document.documentElement.id === '__next_error__') {
                    if (reloading) return;
                    reloading = true;
                    return window.location.reload();
                }
                (0, _react.startTransition)(()=>{
                    _approuterinstance.publicAppRouterInstance.hmrRefresh();
                    _nextdevtools.dispatcher.onRefresh();
                });
                if (process.env.__NEXT_TEST_MODE) {
                    if (self.__NEXT_HMR_CB) {
                        self.__NEXT_HMR_CB();
                        self.__NEXT_HMR_CB = null;
                    }
                }
                return;
            }
        case _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.RELOAD_PAGE:
            {
                turbopackHmr?.onReloadPage();
                sendMessage(JSON.stringify({
                    event: 'client-reload-page',
                    clientId: __nextDevClientId
                }));
                if (reloading) return;
                reloading = true;
                return window.location.reload();
            }
        case _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.ADDED_PAGE:
        case _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.REMOVED_PAGE:
            {
                turbopackHmr?.onPageAddRemove();
                // TODO-APP: potentially only refresh if the currently viewed page was added/removed.
                return _approuterinstance.publicAppRouterInstance.hmrRefresh();
            }
        case _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.SERVER_ERROR:
            {
                const { errorJSON } = message;
                if (errorJSON) {
                    const errorObject = JSON.parse(errorJSON);
                    const error = Object.defineProperty(new Error(errorObject.message), "__NEXT_ERROR_CODE", {
                        value: "E394",
                        enumerable: false,
                        configurable: true
                    });
                    error.stack = errorObject.stack;
                    handleErrors([
                        error
                    ]);
                }
                return;
            }
        case _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.DEV_PAGES_MANIFEST_UPDATE:
            {
                return;
            }
        case _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.DEVTOOLS_CONFIG:
            {
                _nextdevtools.dispatcher.onDevToolsConfig(message.data);
                return;
            }
        case _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.REACT_DEBUG_CHUNK:
            {
                const { requestId, chunk } = message;
                const { writer } = (0, _debugchannel.getOrCreateDebugChannelReadableWriterPair)(requestId);
                if (chunk) {
                    writer.ready.then(()=>writer.write(chunk)).catch(console.error);
                } else {
                    // A null chunk signals that no more chunks will be sent, which allows
                    // us to close the writer.
                    // TODO: Revisit this cleanup logic when we integrate the return channel
                    // that keeps the connection open to be able to lazily retrieve debug
                    // objects.
                    writer.ready.then(()=>writer.close()).catch(console.error);
                }
                return;
            }
        case _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.REQUEST_CURRENT_ERROR_STATE:
            {
                const errorState = (0, _nextdevtools.getSerializedOverlayState)();
                const response = {
                    event: _hotreloadertypes.HMR_MESSAGE_SENT_TO_SERVER.MCP_ERROR_STATE_RESPONSE,
                    requestId: message.requestId,
                    errorState,
                    url: window.location.href
                };
                sendMessage(JSON.stringify(response));
                return;
            }
        case _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.REQUEST_PAGE_METADATA:
            {
                const segmentTrieData = (0, _nextdevtools.getSegmentTrieData)();
                const response = {
                    event: _hotreloadertypes.HMR_MESSAGE_SENT_TO_SERVER.MCP_PAGE_METADATA_RESPONSE,
                    requestId: message.requestId,
                    segmentTrieData,
                    url: window.location.href
                };
                sendMessage(JSON.stringify(response));
                return;
            }
        case _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.CACHE_INDICATOR:
            {
                _nextdevtools.dispatcher.onCacheIndicator(message.state);
                return;
            }
        case _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.ERRORS_TO_SHOW_IN_BROWSER:
            {
                createFromReadableStream(new ReadableStream({
                    start (controller) {
                        controller.enqueue(message.serializedErrors);
                        controller.close();
                    }
                }), {
                    findSourceMapURL: _appfindsourcemapurl.findSourceMapURL
                }).then(({ errors, errorCodes })=>{
                    for (const error of errors){
                        const code = errorCodes.get(error);
                        if (code !== undefined) {
                            Object.defineProperty(error, '__NEXT_ERROR_CODE', {
                                value: code,
                                enumerable: false,
                                configurable: true
                            });
                        }
                        console.error(error);
                    }
                }, (err)=>{
                    console.error(Object.defineProperty(new Error('Failed to deserialize errors.', {
                        cause: err
                    }), "__NEXT_ERROR_CODE", {
                        value: "E946",
                        enumerable: false,
                        configurable: true
                    }));
                });
                return;
            }
        case _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.MIDDLEWARE_CHANGES:
        case _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.CLIENT_CHANGES:
        case _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.SERVER_ONLY_CHANGES:
            break;
        default:
            {
                message;
            }
    }
}
function HotReload({ children, globalError, webSocket, staticIndicatorState }) {
    (0, _useerrorhandler.useErrorHandler)(_nextdevtools.dispatcher.onUnhandledError, _nextdevtools.dispatcher.onUnhandledRejection);
    (0, _websocket.useWebSocketPing)(webSocket);
    // We don't want access of the pathname for the dev tools to trigger a dynamic
    // access (as the dev overlay will never be present in production).
    const pathname = (0, _navigationuntracked.useUntrackedPathname)();
    if (process.env.__NEXT_DEV_INDICATOR) {
        // this conditional is only for dead-code elimination which
        // isn't a runtime conditional only build-time so ignore hooks rule
        // eslint-disable-next-line react-hooks/rules-of-hooks
        (0, _react.useEffect)(()=>{
            if (!staticIndicatorState) {
                throw Object.defineProperty(new _invarianterror.InvariantError('Expected staticIndicatorState to be defined in dev mode.'), "__NEXT_ERROR_CODE", {
                    value: "E786",
                    enumerable: false,
                    configurable: true
                });
            }
            staticIndicatorState.pathname = pathname;
            if (staticIndicatorState.appIsrManifest) {
                const isStatic = pathname ? staticIndicatorState.appIsrManifest[pathname] : undefined;
                _nextdevtools.dispatcher.onStaticIndicator(isStatic === undefined ? 'pending' : isStatic ? 'static' : 'dynamic');
            }
        }, [
            pathname,
            staticIndicatorState
        ]);
    }
    return /*#__PURE__*/ (0, _jsxruntime.jsxs)(_appdevoverlayerrorboundary.AppDevOverlayErrorBoundary, {
        globalError: globalError,
        children: [
            /*#__PURE__*/ (0, _jsxruntime.jsx)(_replayssronlyerrors.ReplaySsrOnlyErrors, {
                onBlockingError: _nextdevtools.dispatcher.openErrorOverlay
            }),
            children
        ]
    });
}

if ((typeof exports.default === 'function' || (typeof exports.default === 'object' && exports.default !== null)) && typeof exports.default.__esModule === 'undefined') {
  Object.defineProperty(exports.default, '__esModule', { value: true });
  Object.assign(exports.default, exports);
  module.exports = exports.default;
}

//# sourceMappingURL=hot-reloader-app.js.map