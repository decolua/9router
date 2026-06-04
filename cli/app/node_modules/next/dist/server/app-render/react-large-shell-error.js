// TODO: isWellKnownError -> isNextInternalError
// isReactLargeShellError -> isWarning
"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "isReactLargeShellError", {
    enumerable: true,
    get: function() {
        return isReactLargeShellError;
    }
});
function isReactLargeShellError(error) {
    return typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string' && error.message.startsWith('This rendered a large document (>');
}

//# sourceMappingURL=react-large-shell-error.js.map