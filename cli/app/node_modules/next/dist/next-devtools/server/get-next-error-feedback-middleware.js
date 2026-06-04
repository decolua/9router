"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "getNextErrorFeedbackMiddleware", {
    enumerable: true,
    get: function() {
        return getNextErrorFeedbackMiddleware;
    }
});
const _errorfeedback = require("../../telemetry/events/error-feedback");
const _middlewareresponse = require("./middleware-response");
function getNextErrorFeedbackMiddleware(telemetry) {
    return async function(req, res, next) {
        const { pathname, searchParams } = new URL(`http://n${req.url}`);
        if (pathname !== '/__nextjs_error_feedback') {
            return next();
        }
        try {
            const errorCode = searchParams.get('errorCode');
            const wasHelpful = searchParams.get('wasHelpful');
            if (!errorCode || !wasHelpful) {
                return _middlewareresponse.middlewareResponse.badRequest(res);
            }
            await telemetry.record((0, _errorfeedback.eventErrorFeedback)({
                errorCode,
                wasHelpful: wasHelpful === 'true'
            }));
            return _middlewareresponse.middlewareResponse.noContent(res);
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

//# sourceMappingURL=get-next-error-feedback-middleware.js.map