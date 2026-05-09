"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "ReplaySsrOnlyErrors", {
    enumerable: true,
    get: function() {
        return ReplaySsrOnlyErrors;
    }
});
const _react = require("react");
const _useerrorhandler = require("./use-error-handler");
const _isnextroutererror = require("../../../../client/components/is-next-router-error");
const _constants = require("../../../../shared/lib/errors/constants");
function readSsrError() {
    if (typeof document === 'undefined') {
        return null;
    }
    const ssrErrorTemplateTag = document.querySelector('template[data-next-error-message]');
    if (ssrErrorTemplateTag) {
        const message = ssrErrorTemplateTag.getAttribute('data-next-error-message');
        const stack = ssrErrorTemplateTag.getAttribute('data-next-error-stack');
        const digest = ssrErrorTemplateTag.getAttribute('data-next-error-digest');
        const error = Object.defineProperty(new Error(message), "__NEXT_ERROR_CODE", {
            value: "E394",
            enumerable: false,
            configurable: true
        });
        if (digest) {
            ;
            error.digest = digest;
        }
        // Skip Next.js SSR'd internal errors that which will be handled by the error boundaries.
        if ((0, _isnextroutererror.isNextRouterError)(error)) {
            return null;
        }
        error.stack = stack || '';
        return error;
    }
    return null;
}
function ReplaySsrOnlyErrors({ onBlockingError }) {
    if (process.env.NODE_ENV !== 'production') {
        // Need to read during render. The attributes will be gone after commit.
        const ssrError = readSsrError();
        // eslint-disable-next-line react-hooks/rules-of-hooks
        (0, _react.useEffect)(()=>{
            if (ssrError !== null) {
                // TODO(veil): Include original Owner Stack (NDX-905)
                // TODO(veil): Mark as recoverable error
                // TODO(veil): console.error
                (0, _useerrorhandler.handleClientError)(ssrError);
                // If it's missing root tags, we can't recover, make it blocking.
                if (ssrError.digest === _constants.MISSING_ROOT_TAGS_ERROR) {
                    onBlockingError();
                }
            }
        }, [
            ssrError,
            onBlockingError
        ]);
    }
    return null;
}

if ((typeof exports.default === 'function' || (typeof exports.default === 'object' && exports.default !== null)) && typeof exports.default.__esModule === 'undefined') {
  Object.defineProperty(exports.default, '__esModule', { value: true });
  Object.assign(exports.default, exports);
  module.exports = exports.default;
}

//# sourceMappingURL=replay-ssr-only-errors.js.map