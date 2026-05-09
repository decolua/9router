"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "getRestartDevServerMiddleware", {
    enumerable: true,
    get: function() {
        return getRestartDevServerMiddleware;
    }
});
const _utils = require("../../server/lib/utils");
const _middlewareresponse = require("./middleware-response");
const _cacheinvalidation = require("../../build/webpack/cache-invalidation");
const EVENT_DEV_OVERLAY_RESTART_SERVER = 'DEV_OVERLAY_RESTART_SERVER';
function getRestartDevServerMiddleware({ telemetry, turbopackProject, webpackCacheDirectories }) {
    /**
   * Some random value between 1 and Number.MAX_SAFE_INTEGER (inclusive). The same value is returned
   * on every call to `__nextjs_server_status` until the server is restarted.
   *
   * Can be used to determine if two server status responses are from the same process or a
   * different (restarted) process.
   */ const executionId = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER) + 1;
    async function handleRestartRequest(req, res, searchParams) {
        if (req.method !== 'POST') {
            return _middlewareresponse.middlewareResponse.methodNotAllowed(res);
        }
        const shouldInvalidateFileSystemCache = searchParams.has('invalidateFileSystemCache');
        if (shouldInvalidateFileSystemCache) {
            if (webpackCacheDirectories != null) {
                await Promise.all(Array.from(webpackCacheDirectories).map(_cacheinvalidation.invalidateFileSystemCache));
            }
            if (turbopackProject != null) {
                await turbopackProject.invalidateFileSystemCache();
            }
        }
        telemetry.record({
            eventName: EVENT_DEV_OVERLAY_RESTART_SERVER,
            payload: {
                invalidateFileSystemCache: shouldInvalidateFileSystemCache
            }
        });
        // TODO: Use flushDetached
        await telemetry.flush();
        // do this async to try to give the response a chance to send
        // it's not really important if it doesn't though
        setTimeout(()=>{
            process.exit(_utils.RESTART_EXIT_CODE);
        }, 0);
        return _middlewareresponse.middlewareResponse.noContent(res);
    }
    async function handleServerStatus(req, res) {
        if (req.method !== 'GET') {
            return _middlewareresponse.middlewareResponse.methodNotAllowed(res);
        }
        return _middlewareresponse.middlewareResponse.json(res, {
            executionId
        });
    }
    return async function(req, res, next) {
        const { pathname, searchParams } = new URL(`http://n${req.url}`);
        switch(pathname){
            case '/__nextjs_restart_dev':
                return await handleRestartRequest(req, res, searchParams);
            case '/__nextjs_server_status':
                return await handleServerStatus(req, res);
            default:
                return next();
        }
    };
}

if ((typeof exports.default === 'function' || (typeof exports.default === 'object' && exports.default !== null)) && typeof exports.default.__esModule === 'undefined') {
  Object.defineProperty(exports.default, '__esModule', { value: true });
  Object.assign(exports.default, exports);
  module.exports = exports.default;
}

//# sourceMappingURL=restart-dev-server-middleware.js.map