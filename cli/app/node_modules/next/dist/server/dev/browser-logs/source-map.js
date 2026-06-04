"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    getConsoleLocation: null,
    getSourceMappedStackFrames: null,
    mapFramesUsingBundler: null,
    withLocation: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    getConsoleLocation: function() {
        return getConsoleLocation;
    },
    getSourceMappedStackFrames: function() {
        return getSourceMappedStackFrames;
    },
    mapFramesUsingBundler: function() {
        return mapFramesUsingBundler;
    },
    withLocation: function() {
        return withLocation;
    }
});
const _middlewarewebpack = require("../middleware-webpack");
const _middlewareturbopack = require("../middleware-turbopack");
const _picocolors = require("../../../lib/picocolors");
const _parsestack = require("../../lib/parse-stack");
const _path = /*#__PURE__*/ _interop_require_default(require("path"));
const _lrucache = require("../../lib/lru-cache");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
async function mapFramesUsingBundler(frames, ctx) {
    switch(ctx.bundler){
        case 'webpack':
            {
                const { isServer, isEdgeServer, isAppDirectory, clientStats, serverStats, edgeServerStats, rootDirectory } = ctx;
                const res = await (0, _middlewarewebpack.getOriginalStackFrames)({
                    isServer,
                    isEdgeServer,
                    isAppDirectory,
                    frames,
                    clientStats,
                    serverStats,
                    edgeServerStats,
                    rootDirectory
                });
                return res;
            }
        case 'turbopack':
            {
                const { project, projectPath, isServer, isEdgeServer, isAppDirectory } = ctx;
                const res = await (0, _middlewareturbopack.getOriginalStackFrames)({
                    project,
                    projectPath,
                    frames,
                    isServer,
                    isEdgeServer,
                    isAppDirectory
                });
                return res;
            }
        default:
            {
                return null;
            }
    }
}
// converts _next/static/chunks/... to file:///.next/static/chunks/... for parseStack
// todo: where does next dev overlay handle this case and re-use that logic
function preprocessStackTrace(stackTrace, distDir) {
    return stackTrace.split('\n').map((line)=>{
        const match = line.match(/^(\s*at\s+.*?)\s+\(([^)]+)\)$/);
        if (match) {
            const [, prefix, location] = match;
            if (location.startsWith('_next/static/') && distDir) {
                const normalizedDistDir = distDir.replace(/\\/g, '/').replace(/\/$/, '');
                const absolutePath = normalizedDistDir + '/' + location.slice('_next/'.length);
                const fileUrl = `file://${_path.default.resolve(absolutePath)}`;
                return `${prefix} (${fileUrl})`;
            }
        }
        return line;
    }).join('\n');
}
const cache = new _lrucache.LRUCache(25);
async function getSourceMappedStackFramesInternal(stackTrace, ctx, distDir, ignore = true) {
    try {
        var _filteredFrames_find;
        const normalizedStack = preprocessStackTrace(stackTrace, distDir);
        const frames = (0, _parsestack.parseStack)(normalizedStack, distDir);
        if (frames.length === 0) {
            return {
                kind: 'stack',
                stack: stackTrace
            };
        }
        const mappingResults = await mapFramesUsingBundler(frames, ctx);
        const processedFrames = mappingResults.map((result, index)=>({
                result,
                originalFrame: frames[index]
            })).map(({ result, originalFrame })=>{
            var _originalStackFrame_file;
            if (result.status === 'rejected') {
                return {
                    kind: 'rejected',
                    frameText: formatStackFrame(originalFrame),
                    codeFrame: null
                };
            }
            const { originalStackFrame, originalCodeFrame } = result.value;
            if ((originalStackFrame == null ? void 0 : originalStackFrame.ignored) && ignore) {
                return {
                    kind: 'ignored'
                };
            }
            // should we apply this generally to dev overlay (dev overlay does not ignore chrome-extension://)
            if (originalStackFrame == null ? void 0 : (_originalStackFrame_file = originalStackFrame.file) == null ? void 0 : _originalStackFrame_file.startsWith('chrome-extension://')) {
                return {
                    kind: 'ignored'
                };
            }
            return {
                kind: 'success',
                // invariant: if result is not rejected and not ignored, then original stack frame exists
                // verifiable by tracing `getOriginalStackFrame`. The invariant exists because of bad types
                frameText: formatStackFrame(originalStackFrame),
                codeFrame: originalCodeFrame
            };
        });
        const allIgnored = processedFrames.every((frame)=>frame.kind === 'ignored');
        // we want to handle **all** ignored vs all/some rejected differently
        // if all are ignored we should show no frames
        // if all are rejected, we want to fallback to showing original stack frames
        if (allIgnored) {
            return {
                kind: 'all-ignored'
            };
        }
        const filteredFrames = processedFrames.filter((frame)=>frame.kind !== 'ignored');
        if (filteredFrames.length === 0) {
            return {
                kind: 'stack',
                stack: stackTrace
            };
        }
        const stackOutput = filteredFrames.map((frame)=>frame.frameText).join('\n');
        const firstFrameCode = (_filteredFrames_find = filteredFrames.find((frame)=>frame.codeFrame)) == null ? void 0 : _filteredFrames_find.codeFrame;
        if (firstFrameCode) {
            return {
                kind: 'with-frame-code',
                frameCode: firstFrameCode,
                stack: stackOutput,
                frames: filteredFrames
            };
        }
        // i don't think this a real case, but good for exhaustion
        return {
            kind: 'mapped-stack',
            stack: stackOutput,
            frames: filteredFrames
        };
    } catch (error) {
        return {
            kind: 'stack',
            stack: stackTrace
        };
    }
}
async function getSourceMappedStackFrames(stackTrace, ctx, distDir, ignore = true) {
    const cacheKey = `sm_${stackTrace}-${ctx.bundler}-${ctx.isAppDirectory}-${ctx.isEdgeServer}-${ctx.isServer}-${distDir}-${ignore}`;
    const cacheItem = cache.get(cacheKey);
    if (cacheItem) {
        return cacheItem;
    }
    const result = await getSourceMappedStackFramesInternal(stackTrace, ctx, distDir, ignore);
    cache.set(cacheKey, result);
    return result;
}
function formatStackFrame(frame) {
    const functionName = frame.methodName || '<anonymous>';
    const location = frame.file && frame.line1 ? `${frame.file}:${frame.line1}${frame.column1 ? `:${frame.column1}` : ''}` : frame.file || '<unknown>';
    return `    at ${functionName} (${location})`;
}
const withLocation = async ({ original, stack }, ctx, distDir, _config)=>{
    if (!stack) {
        return original;
    }
    const res = await getSourceMappedStackFrames(stack, ctx, distDir);
    const location = getConsoleLocation(res);
    if (!location) {
        return original;
    }
    return [
        ...original,
        (0, _picocolors.dim)(`(${location})`)
    ];
};
const getConsoleLocation = (mapped)=>{
    if (mapped.kind !== 'mapped-stack' && mapped.kind !== 'with-frame-code') {
        return null;
    }
    const first = mapped.frames.at(0);
    if (!first) {
        return null;
    }
    // we don't want to show the name of parent function (at <fn> thing in stack), just source location for minimal noise
    const match = first.frameText.match(/\(([^)]+)\)/);
    const locationText = match ? match[1] : first.frameText;
    return locationText;
};

//# sourceMappingURL=source-map.js.map