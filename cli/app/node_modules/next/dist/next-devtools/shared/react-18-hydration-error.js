"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    getHydrationWarningType: null,
    isHydrationError: null,
    isHydrationWarning: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    getHydrationWarningType: function() {
        return getHydrationWarningType;
    },
    isHydrationError: function() {
        return isHydrationError;
    },
    isHydrationWarning: function() {
        return isHydrationWarning;
    }
});
const _interop_require_default = require("@swc/helpers/_/_interop_require_default");
const _iserror = /*#__PURE__*/ _interop_require_default._(require("../../lib/is-error"));
function isHydrationError(error) {
    return (0, _iserror.default)(error) && (error.message === 'Hydration failed because the initial UI does not match what was rendered on the server.' || error.message === 'Text content does not match server-rendered HTML.');
}
function isHydrationWarning(message) {
    return isHtmlTagsWarning(message) || isTextInTagsMismatchWarning(message) || isTextWarning(message);
}
// https://github.com/facebook/react/blob/main/packages/react-dom/src/__tests__/ReactDOMHydrationDiff-test.js used as a reference
const htmlTagsWarnings = new Set([
    'Warning: Expected server HTML to contain a matching <%s> in <%s>.%s',
    'Warning: Did not expect server HTML to contain a <%s> in <%s>.%s'
]);
const textAndTagsMismatchWarnings = new Set([
    'Warning: Expected server HTML to contain a matching text node for "%s" in <%s>.%s',
    'Warning: Did not expect server HTML to contain the text node "%s" in <%s>.%s'
]);
const textWarnings = new Set([
    'Warning: Text content did not match. Server: "%s" Client: "%s"%s'
]);
const getHydrationWarningType = (message)=>{
    if (typeof message !== 'string') {
        // TODO: Doesn't make sense to treat no message as a hydration error message.
        // We should bail out somewhere earlier.
        return 'text';
    }
    const normalizedMessage = message.startsWith('Warning: ') ? message : `Warning: ${message}`;
    if (isHtmlTagsWarning(normalizedMessage)) return 'tag';
    if (isTextInTagsMismatchWarning(normalizedMessage)) return 'text-in-tag';
    return 'text';
};
const isHtmlTagsWarning = (message)=>typeof message === 'string' && htmlTagsWarnings.has(message);
const isTextInTagsMismatchWarning = (msg)=>typeof msg === 'string' && textAndTagsMismatchWarnings.has(msg);
const isTextWarning = (msg)=>typeof msg === 'string' && textWarnings.has(msg);

if ((typeof exports.default === 'function' || (typeof exports.default === 'object' && exports.default !== null)) && typeof exports.default.__esModule === 'undefined') {
  Object.defineProperty(exports.default, '__esModule', { value: true });
  Object.assign(exports.default, exports);
  module.exports = exports.default;
}

//# sourceMappingURL=react-18-hydration-error.js.map