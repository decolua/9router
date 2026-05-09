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
const _interop_require_default = require("@swc/helpers/_/_interop_require_default");
const _jsxruntime = require("react/jsx-runtime");
const _react = /*#__PURE__*/ _interop_require_default._(require("react"));
const _errorstyles = require("./error-styles");
// This is the static 500.html page for App Router apps.
// Always a server error, rendered at build time.
function AppError() {
    return /*#__PURE__*/ (0, _jsxruntime.jsxs)("html", {
        id: "__next_error__",
        children: [
            /*#__PURE__*/ (0, _jsxruntime.jsxs)("head", {
                children: [
                    /*#__PURE__*/ (0, _jsxruntime.jsx)("title", {
                        children: "500: This page couldn’t load"
                    }),
                    /*#__PURE__*/ (0, _jsxruntime.jsx)("style", {
                        dangerouslySetInnerHTML: {
                            __html: _errorstyles.errorThemeCss
                        }
                    })
                ]
            }),
            /*#__PURE__*/ (0, _jsxruntime.jsx)("body", {
                children: /*#__PURE__*/ (0, _jsxruntime.jsx)("div", {
                    style: _errorstyles.errorStyles.container,
                    children: /*#__PURE__*/ (0, _jsxruntime.jsxs)("div", {
                        style: _errorstyles.errorStyles.card,
                        children: [
                            /*#__PURE__*/ (0, _jsxruntime.jsx)(_errorstyles.WarningIcon, {}),
                            /*#__PURE__*/ (0, _jsxruntime.jsx)("h1", {
                                style: _errorstyles.errorStyles.title,
                                children: "This page couldn’t load"
                            }),
                            /*#__PURE__*/ (0, _jsxruntime.jsx)("p", {
                                style: _errorstyles.errorStyles.message,
                                children: "A server error occurred. Reload to try again."
                            }),
                            /*#__PURE__*/ (0, _jsxruntime.jsx)("form", {
                                style: _errorstyles.errorStyles.form,
                                children: /*#__PURE__*/ (0, _jsxruntime.jsx)("button", {
                                    type: "submit",
                                    style: _errorstyles.errorStyles.button,
                                    children: "Reload"
                                })
                            })
                        ]
                    })
                })
            })
        ]
    });
}
const _default = AppError;

if ((typeof exports.default === 'function' || (typeof exports.default === 'object' && exports.default !== null)) && typeof exports.default.__esModule === 'undefined') {
  Object.defineProperty(exports.default, '__esModule', { value: true });
  Object.assign(exports.default, exports);
  module.exports = exports.default;
}

//# sourceMappingURL=app-error.js.map