"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    NEXTJS_HYDRATION_ERROR_LINK: null,
    REACT_HYDRATION_ERROR_LINK: null,
    getHydrationErrorStackInfo: null,
    isErrorMessageWithComponentStackDiff: null,
    isHydrationError: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    NEXTJS_HYDRATION_ERROR_LINK: function() {
        return NEXTJS_HYDRATION_ERROR_LINK;
    },
    REACT_HYDRATION_ERROR_LINK: function() {
        return REACT_HYDRATION_ERROR_LINK;
    },
    getHydrationErrorStackInfo: function() {
        return getHydrationErrorStackInfo;
    },
    isErrorMessageWithComponentStackDiff: function() {
        return isErrorMessageWithComponentStackDiff;
    },
    isHydrationError: function() {
        return isHydrationError;
    }
});
const REACT_HYDRATION_ERROR_LINK = 'https://react.dev/link/hydration-mismatch';
const NEXTJS_HYDRATION_ERROR_LINK = 'https://nextjs.org/docs/messages/react-hydration-error';
/**
 * Only React 19+ contains component stack diff in the error message
 */ const errorMessagesWithComponentStackDiff = [
    /^In HTML, (.+?) cannot be a child of <(.+?)>\.(.*)\nThis will cause a hydration error\.(.*)/,
    /^In HTML, (.+?) cannot be a descendant of <(.+?)>\.\nThis will cause a hydration error\.(.*)/,
    /^In HTML, text nodes cannot be a child of <(.+?)>\.\nThis will cause a hydration error\./,
    /^In HTML, whitespace text nodes cannot be a child of <(.+?)>\. Make sure you don't have any extra whitespace between tags on each line of your source code\.\nThis will cause a hydration error\./
];
function isHydrationError(error) {
    return isErrorMessageWithComponentStackDiff(error.message) || /Hydration failed because the server rendered (text|HTML) didn't match the client\./.test(error.message) || /A tree hydrated but some attributes of the server rendered HTML didn't match the client properties./.test(error.message);
}
function isErrorMessageWithComponentStackDiff(msg) {
    return errorMessagesWithComponentStackDiff.some((regex)=>regex.test(msg));
}
function getHydrationErrorStackInfo(error) {
    const errorMessage = error.message;
    if (isErrorMessageWithComponentStackDiff(errorMessage)) {
        const [message, diffLog = ''] = errorMessage.split('\n\n');
        const diff = diffLog.trim();
        return {
            message: diff === '' ? errorMessage.trim() : message.trim(),
            diff,
            notes: null
        };
    }
    const [message, maybeComponentStackDiff] = errorMessage.split(`${REACT_HYDRATION_ERROR_LINK}`);
    const trimmedMessage = message.trim();
    // React built-in hydration diff starts with a newline
    if (maybeComponentStackDiff !== undefined && maybeComponentStackDiff.length > 1) {
        const diffs = [];
        maybeComponentStackDiff.split('\n').forEach((line)=>{
            if (line.trim() === '') return;
            if (!line.trim().startsWith('at ')) {
                diffs.push(line);
            }
        });
        const [displayedMessage, ...notes] = trimmedMessage.split('\n\n');
        return {
            message: displayedMessage,
            diff: diffs.join('\n'),
            notes: notes.join('\n\n') || null
        };
    } else {
        const [displayedMessage, ...notes] = trimmedMessage.split('\n\n');
        return {
            message: displayedMessage,
            diff: null,
            notes: notes.join('\n\n')
        };
    }
}

if ((typeof exports.default === 'function' || (typeof exports.default === 'object' && exports.default !== null)) && typeof exports.default.__esModule === 'undefined') {
  Object.defineProperty(exports.default, '__esModule', { value: true });
  Object.assign(exports.default, exports);
  module.exports = exports.default;
}

//# sourceMappingURL=react-19-hydration-error.js.map