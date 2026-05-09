"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "default", {
    enumerable: true,
    get: function() {
        return _default;
    }
});
const _jsxruntime = require("react/jsx-runtime");
const _errorfallback = require("../http-access-fallback/error-fallback");
function GlobalNotFound() {
    return /*#__PURE__*/ (0, _jsxruntime.jsx)("html", {
        children: /*#__PURE__*/ (0, _jsxruntime.jsx)("body", {
            children: /*#__PURE__*/ (0, _jsxruntime.jsx)(_errorfallback.HTTPAccessErrorFallback, {
                status: 404,
                message: 'This page could not be found.'
            })
        })
    });
}
const _default = GlobalNotFound;

if ((typeof exports.default === 'function' || (typeof exports.default === 'object' && exports.default !== null)) && typeof exports.default.__esModule === 'undefined') {
  Object.defineProperty(exports.default, '__esModule', { value: true });
  Object.assign(exports.default, exports);
  module.exports = exports.default;
}

//# sourceMappingURL=global-not-found.js.map