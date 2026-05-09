"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    clearAllModuleContexts: null,
    clearModuleContext: null,
    getServerField: null,
    initialize: null,
    propagateServerField: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    clearAllModuleContexts: function() {
        return clearAllModuleContexts;
    },
    clearModuleContext: function() {
        return clearModuleContext;
    },
    getServerField: function() {
        return getServerField;
    },
    initialize: function() {
        return initialize;
    },
    propagateServerField: function() {
        return propagateServerField;
    }
});
const _next = /*#__PURE__*/ _interop_require_default(require("../next"));
const _interopdefault = require("../../lib/interop-default");
const _formatdynamicimportpath = require("../../lib/format-dynamic-import-path");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
let initializations = {};
let sandboxContext;
if (process.env.NODE_ENV !== 'production') {
    sandboxContext = require('../web/sandbox/context');
}
function clearAllModuleContexts() {
    return sandboxContext == null ? void 0 : sandboxContext.clearAllModuleContexts();
}
function clearModuleContext(target) {
    return sandboxContext == null ? void 0 : sandboxContext.clearModuleContext(target);
}
async function getServerField(dir, field) {
    const initialization = await initializations[dir];
    if (!initialization) {
        throw Object.defineProperty(new Error('Invariant cant propagate server field, no app initialized'), "__NEXT_ERROR_CODE", {
            value: "E116",
            enumerable: false,
            configurable: true
        });
    }
    const { server } = initialization;
    let wrappedServer = server['server']// NextServer.server is private
    ;
    return wrappedServer[field];
}
async function propagateServerField(dir, field, value) {
    const initialization = await initializations[dir];
    if (!initialization) {
        throw Object.defineProperty(new Error('Invariant cant propagate server field, no app initialized'), "__NEXT_ERROR_CODE", {
            value: "E116",
            enumerable: false,
            configurable: true
        });
    }
    const { server } = initialization;
    let wrappedServer = server['server'];
    const _field = field;
    if (wrappedServer) {
        if (typeof wrappedServer[_field] === 'function') {
            // @ts-expect-error
            await wrappedServer[_field].apply(wrappedServer, Array.isArray(value) ? value : []);
        } else {
            // @ts-expect-error
            wrappedServer[_field] = value;
        }
    }
}
async function initializeImpl(opts) {
    const type = process.env.__NEXT_PRIVATE_RENDER_WORKER;
    if (type) {
        process.title = 'next-render-worker-' + type;
    }
    let requestHandler;
    let upgradeHandler;
    const server = (0, _next.default)({
        ...opts,
        hostname: opts.hostname || 'localhost',
        customServer: false,
        httpServer: opts.server,
        port: opts.port
    })// should return a NextServer when `customServer: false`
    ;
    // If we're in test mode and there's a debug cache entry handler available,
    // then use it to wrap the request handler instead of using the default one.
    if (process.env.__NEXT_TEST_MODE && process.env.NEXT_PRIVATE_DEBUG_CACHE_ENTRY_HANDLERS) {
        // This mirrors the sole implementation of this over in:
        // test/production/standalone-mode/required-server-files/cache-entry-handler.js
        const createOnCacheEntryHandlers = (0, _interopdefault.interopDefault)(await import((0, _formatdynamicimportpath.formatDynamicImportPath)(opts.dir, process.env.NEXT_PRIVATE_DEBUG_CACHE_ENTRY_HANDLERS)));
        // This is not to be used in any environment other than testing, as it is
        // not memoized and is subject to constant change.
        requestHandler = async (req, res, parsedUrl)=>{
            // Re re-create the entry handler for each request. This is not
            // performant, and is only used in testing environments.
            const { // TODO: remove onCacheEntry once onCacheEntryV2 is the default.
            onCacheEntry, onCacheEntryV2 } = createOnCacheEntryHandlers(res);
            // Get the request handler, using the entry handler as the metadata each
            // request.
            const handler = server.getRequestHandlerWithMetadata({
                // TODO: remove onCacheEntry once onCacheEntryV2 is the default.
                onCacheEntry,
                onCacheEntryV2
            });
            return handler(req, res, parsedUrl);
        };
        upgradeHandler = server.getUpgradeHandler();
    } else {
        requestHandler = server.getRequestHandler();
        upgradeHandler = server.getUpgradeHandler();
    }
    await server.prepare(opts.serverFields);
    return {
        requestHandler,
        upgradeHandler,
        server,
        closeUpgraded () {
            var _opts_bundlerService;
            (_opts_bundlerService = opts.bundlerService) == null ? void 0 : _opts_bundlerService.close();
        },
        distDir: opts.distDir,
        experimentalFeatures: opts.experimentalFeatures,
        cacheComponents: opts.cacheComponents
    };
}
async function initialize(opts) {
    // if we already setup the server return as we only need to do
    // this on first worker boot
    if (initializations[opts.dir]) {
        return initializations[opts.dir];
    }
    return initializations[opts.dir] = initializeImpl(opts);
}

//# sourceMappingURL=render-server.js.map