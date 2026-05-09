"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    getOriginalCodeFrame: null,
    ignoreListAnonymousStackFramesIfSandwiched: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    getOriginalCodeFrame: function() {
        return getOriginalCodeFrame;
    },
    ignoreListAnonymousStackFramesIfSandwiched: function() {
        return ignoreListAnonymousStackFramesIfSandwiched;
    }
});
const _codeframe = require("../../shared/lib/errors/code-frame");
const _sourcemaps = require("../../server/lib/source-maps");
function ignoreListAnonymousStackFramesIfSandwiched(responses) {
    (0, _sourcemaps.ignoreListAnonymousStackFramesIfSandwiched)(responses, (response)=>{
        return response.status === 'fulfilled' && response.value.originalStackFrame !== null && response.value.originalStackFrame.file === '<anonymous>';
    }, (response)=>{
        return response.status === 'fulfilled' && response.value.originalStackFrame !== null && response.value.originalStackFrame.ignored === true;
    }, (response)=>{
        return response.status === 'fulfilled' && response.value.originalStackFrame !== null ? response.value.originalStackFrame.methodName : '';
    }, (response)=>{
        ;
        response.value.originalStackFrame.ignored = true;
    });
}
function getOriginalCodeFrame(frame, source, colors = process.stdout.isTTY) {
    if (!source || frame.line1 == null) {
        return null;
    }
    return (0, _codeframe.codeFrameColumns)(source, {
        start: {
            line: frame.line1,
            column: frame.column1 ?? undefined
        }
    }, {
        color: colors
    }) ?? null;
}

if ((typeof exports.default === 'function' || (typeof exports.default === 'object' && exports.default !== null)) && typeof exports.default.__esModule === 'undefined') {
  Object.defineProperty(exports.default, '__esModule', { value: true });
  Object.assign(exports.default, exports);
  module.exports = exports.default;
}

//# sourceMappingURL=shared.js.map