"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "getAttachNodejsDebuggerMiddleware", {
    enumerable: true,
    get: function() {
        return getAttachNodejsDebuggerMiddleware;
    }
});
const _interop_require_wildcard = require("@swc/helpers/_/_interop_require_wildcard");
const _middlewareresponse = require("./middleware-response");
const _inspector = /*#__PURE__*/ _interop_require_wildcard._(require("inspector"));
function getAttachNodejsDebuggerMiddleware() {
    return async function(req, res, next) {
        const { pathname } = new URL(`http://n${req.url}`);
        if (pathname !== '/__nextjs_attach-nodejs-inspector') {
            return next();
        }
        try {
            const isInspecting = _inspector.url() !== undefined;
            const debugPort = process.debugPort;
            if (!isInspecting) {
                // Node.js will already log that the inspector is listening.
                _inspector.open(debugPort);
            }
            const inspectorURLRaw = _inspector.url();
            if (inspectorURLRaw === undefined) {
                // could not open, possibly because already in use.
                return _middlewareresponse.middlewareResponse.badRequest(res, `Failed to open port "${debugPort}". Address may be already in use.`);
            }
            const inspectorURL = new URL(inspectorURLRaw);
            const debugInfoListResponse = await fetch(`http://${inspectorURL.host}/json/list`);
            const debugInfoList = await debugInfoListResponse.json();
            if (!Array.isArray(debugInfoList) || debugInfoList.length === 0) {
                throw Object.defineProperty(new Error('No debug targets found'), "__NEXT_ERROR_CODE", {
                    value: "E927",
                    enumerable: false,
                    configurable: true
                });
            }
            return _middlewareresponse.middlewareResponse.json(res, debugInfoList[0].devtoolsFrontendUrl);
        } catch (error) {
            return _middlewareresponse.middlewareResponse.internalServerError(res);
        }
    };
}

if ((typeof exports.default === 'function' || (typeof exports.default === 'object' && exports.default !== null)) && typeof exports.default.__esModule === 'undefined') {
  Object.defineProperty(exports.default, '__esModule', { value: true });
  Object.assign(exports.default, exports);
  module.exports = exports.default;
}

//# sourceMappingURL=attach-nodejs-debugger-middleware.js.map