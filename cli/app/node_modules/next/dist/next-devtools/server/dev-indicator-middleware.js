"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "getDisableDevIndicatorMiddleware", {
    enumerable: true,
    get: function() {
        return getDisableDevIndicatorMiddleware;
    }
});
const _interop_require_wildcard = require("@swc/helpers/_/_interop_require_wildcard");
const _middlewareresponse = require("./middleware-response");
const _log = /*#__PURE__*/ _interop_require_wildcard._(require("../../build/output/log"));
const _devindicatorserverstate = require("../../server/dev/dev-indicator-server-state");
const DISABLE_DEV_INDICATOR_PREFIX = '/__nextjs_disable_dev_indicator';
const COOLDOWN_TIME_MS = process.env.__NEXT_DEV_INDICATOR_COOLDOWN_MS ? parseInt(process.env.__NEXT_DEV_INDICATOR_COOLDOWN_MS) : 1000 * 60 * 60 * 24;
function getDisableDevIndicatorMiddleware() {
    return async function disableDevIndicatorMiddleware(req, res, next) {
        try {
            const { pathname } = new URL(`http://n${req.url}`);
            if (!pathname.startsWith(DISABLE_DEV_INDICATOR_PREFIX)) {
                return next();
            }
            if (req.method !== 'POST') {
                return _middlewareresponse.middlewareResponse.methodNotAllowed(res);
            }
            _devindicatorserverstate.devIndicatorServerState.disabledUntil = Date.now() + COOLDOWN_TIME_MS;
            return _middlewareresponse.middlewareResponse.noContent(res);
        } catch (err) {
            _log.error('Failed to disable the dev indicator:', err instanceof Error ? err.message : err);
            return _middlewareresponse.middlewareResponse.internalServerError(res);
        }
    };
}

if ((typeof exports.default === 'function' || (typeof exports.default === 'object' && exports.default !== null)) && typeof exports.default.__esModule === 'undefined') {
  Object.defineProperty(exports.default, '__esModule', { value: true });
  Object.assign(exports.default, exports);
  module.exports = exports.default;
}

//# sourceMappingURL=dev-indicator-middleware.js.map