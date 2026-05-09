"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    formatErrors: null,
    setStackFrameResolver: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    formatErrors: function() {
        return formatErrors;
    },
    setStackFrameResolver: function() {
        return setStackFrameResolver;
    }
});
const _errorsource = require("../../../../shared/lib/error-source");
// Dependency injection for stack frame resolver
let stackFrameResolver;
function setStackFrameResolver(fn) {
    stackFrameResolver = fn;
}
async function resolveStackFrames(request) {
    if (!stackFrameResolver) {
        throw Object.defineProperty(new Error('Stack frame resolver not initialized. This is a bug in Next.js.'), "__NEXT_ERROR_CODE", {
            value: "E822",
            enumerable: false,
            configurable: true
        });
    }
    return stackFrameResolver(request);
}
const formatStackFrameToObject = (frame)=>{
    return {
        file: frame.file || '<unknown>',
        methodName: frame.methodName || '<anonymous>',
        line: frame.line1,
        column: frame.column1
    };
};
const resolveErrorFrames = async (frames, context)=>{
    try {
        const resolvedFrames = await resolveStackFrames({
            frames: frames.map((frame)=>({
                    file: frame.file || null,
                    methodName: frame.methodName || '<anonymous>',
                    arguments: [],
                    line1: frame.line1 || null,
                    column1: frame.column1 || null
                })),
            isServer: context.isServer,
            isEdgeServer: context.isEdgeServer,
            isAppDirectory: context.isAppDirectory
        });
        return resolvedFrames.filter((resolvedFrame)=>{
            var _resolvedFrame_value_originalStackFrame;
            return !(resolvedFrame.status === 'fulfilled' && ((_resolvedFrame_value_originalStackFrame = resolvedFrame.value.originalStackFrame) == null ? void 0 : _resolvedFrame_value_originalStackFrame.ignored));
        }).map((resolvedFrame, j)=>resolvedFrame.status === 'fulfilled' && resolvedFrame.value.originalStackFrame ? formatStackFrameToObject(resolvedFrame.value.originalStackFrame) : formatStackFrameToObject(frames[j]));
    } catch  {
        return frames.map(formatStackFrameToObject);
    }
};
async function formatRuntimeErrorsToObjects(errors, isAppDirectory) {
    const formattedErrors = [];
    for (const error of errors){
        var _error_error, _error_error1, _error_frames;
        const errorName = ((_error_error = error.error) == null ? void 0 : _error_error.name) || 'Error';
        const errorMsg = ((_error_error1 = error.error) == null ? void 0 : _error_error1.message) || 'Unknown error';
        let stack = [];
        if ((_error_frames = error.frames) == null ? void 0 : _error_frames.length) {
            const errorSource = (0, _errorsource.getErrorSource)(error.error);
            stack = await resolveErrorFrames(error.frames, {
                isServer: errorSource === 'server',
                isEdgeServer: errorSource === 'edge-server',
                isAppDirectory
            });
        }
        formattedErrors.push({
            type: error.type,
            errorName,
            message: errorMsg,
            stack
        });
    }
    return formattedErrors;
}
async function formatErrors(errorsByUrl, nextInstanceErrors = {
    nextConfig: []
}) {
    const output = {
        configErrors: [],
        sessionErrors: []
    };
    // Format Next.js instance errors first (e.g., next.config.js errors)
    for (const error of nextInstanceErrors.nextConfig){
        if (error instanceof Error) {
            output.configErrors.push({
                name: error.name,
                message: error.message,
                stack: error.stack || null
            });
        } else {
            output.configErrors.push({
                name: 'Error',
                message: String(error),
                stack: null
            });
        }
    }
    // Format browser session errors
    for (const [url, overlayState] of errorsByUrl){
        const totalErrorCount = overlayState.errors.length + (overlayState.buildError ? 1 : 0);
        if (totalErrorCount === 0) continue;
        let displayUrl = url;
        try {
            const urlObj = new URL(url);
            displayUrl = urlObj.pathname + urlObj.search + urlObj.hash;
        } catch  {
        // If URL parsing fails, use the original URL
        }
        const runtimeErrors = await formatRuntimeErrorsToObjects(overlayState.errors, overlayState.routerType === 'app');
        output.sessionErrors.push({
            url: displayUrl,
            buildError: overlayState.buildError || null,
            runtimeErrors
        });
    }
    return output;
}

//# sourceMappingURL=format-errors.js.map