"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    coerceError: null,
    decorateDevError: null,
    getOwnerStack: null,
    setOwnerStack: null,
    setOwnerStackIfAvailable: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    coerceError: function() {
        return coerceError;
    },
    decorateDevError: function() {
        return decorateDevError;
    },
    getOwnerStack: function() {
        return getOwnerStack;
    },
    setOwnerStack: function() {
        return setOwnerStack;
    },
    setOwnerStackIfAvailable: function() {
        return setOwnerStackIfAvailable;
    }
});
const _interop_require_default = require("@swc/helpers/_/_interop_require_default");
const _react = /*#__PURE__*/ _interop_require_default._(require("react"));
const _iserror = /*#__PURE__*/ _interop_require_default._(require("../../../../lib/is-error"));
const ownerStacks = new WeakMap();
function getOwnerStack(error) {
    return ownerStacks.get(error);
}
function setOwnerStack(error, stack) {
    ownerStacks.set(error, stack);
}
function coerceError(value) {
    return (0, _iserror.default)(value) ? value : Object.defineProperty(new Error('' + value), "__NEXT_ERROR_CODE", {
        value: "E394",
        enumerable: false,
        configurable: true
    });
}
function setOwnerStackIfAvailable(error) {
    // React 18 and prod does not have `captureOwnerStack`
    if ('captureOwnerStack' in _react.default) {
        const ownerStack = _react.default.captureOwnerStack();
        // Only set if we captured a valid owner stack, or if none exists yet.
        // This prevents overwriting a valid owner stack captured earlier
        // (e.g., in onRecoverableError) with null captured later.
        if (ownerStack || !ownerStacks.has(error)) {
            setOwnerStack(error, ownerStack);
        }
    }
}
function decorateDevError(thrownValue) {
    const error = coerceError(thrownValue);
    setOwnerStackIfAvailable(error);
    return error;
}

if ((typeof exports.default === 'function' || (typeof exports.default === 'object' && exports.default !== null)) && typeof exports.default.__esModule === 'undefined') {
  Object.defineProperty(exports.default, '__esModule', { value: true });
  Object.assign(exports.default, exports);
  module.exports = exports.default;
}

//# sourceMappingURL=stitched-error.js.map