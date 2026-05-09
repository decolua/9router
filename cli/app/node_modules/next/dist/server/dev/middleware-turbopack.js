"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    getOriginalStackFrames: null,
    getOverlayMiddleware: null,
    getSourceMapMiddleware: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    getOriginalStackFrames: function() {
        return getOriginalStackFrames;
    },
    getOverlayMiddleware: function() {
        return getOverlayMiddleware;
    },
    getSourceMapMiddleware: function() {
        return getSourceMapMiddleware;
    }
});
const _shared = require("../../next-devtools/server/shared");
const _middlewareresponse = require("../../next-devtools/server/middleware-response");
const _path = /*#__PURE__*/ _interop_require_default(require("path"));
const _launcheditor = require("../../next-devtools/server/launch-editor");
const _sourcemap08 = require("next/dist/compiled/source-map08");
const _sourcemaps = require("../lib/source-maps");
const _nodemodule = require("node:module");
const _nodeurl = require("node:url");
const _nodeutil = require("node:util");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
function shouldIgnorePath(modulePath) {
    return modulePath.includes('node_modules') || // Only relevant for when Next.js is symlinked e.g. in the Next.js monorepo
    modulePath.includes('next/dist') || modulePath.startsWith('node:');
}
const currentSourcesByFile = new Map();
/**
 * @returns 1-based lines and 1-based columns
 */ async function batchedTraceSource(project, frame) {
    const file = frame.file ? decodeURIComponent(frame.file) : undefined;
    if (!file) return;
    // For node internals they cannot traced the actual source code with project.traceSource,
    // we need an early return to indicate it's ignored to avoid the unknown scheme error from `project.traceSource`.
    if (file.startsWith('node:')) {
        return {
            frame: {
                file,
                line1: frame.line ?? null,
                column1: frame.column ?? null,
                methodName: frame.methodName ?? '<unknown>',
                ignored: true,
                arguments: []
            },
            source: null
        };
    }
    const currentDirectoryFileUrl = (0, _nodeurl.pathToFileURL)(process.cwd()).href;
    const sourceFrame = await project.traceSource(frame, currentDirectoryFileUrl);
    if (!sourceFrame) {
        return {
            frame: {
                file,
                line1: frame.line ?? null,
                column1: frame.column ?? null,
                methodName: frame.methodName ?? '<unknown>',
                ignored: shouldIgnorePath(file),
                arguments: []
            },
            source: null
        };
    }
    let source = null;
    const originalFile = sourceFrame.originalFile;
    // Don't look up source for node_modules or internals. These can often be large bundled files.
    const ignored = // Check the sourcemap's ignoreList (e.g. from 3rd party packages)
    !!sourceFrame.isIgnored || shouldIgnorePath(originalFile ?? sourceFrame.file);
    if (originalFile && !ignored) {
        let sourcePromise = currentSourcesByFile.get(originalFile);
        if (!sourcePromise) {
            sourcePromise = project.getSourceForAsset(originalFile);
            currentSourcesByFile.set(originalFile, sourcePromise);
            setTimeout(()=>{
                // Cache file reads for 100ms, as frames will often reference the same
                // files and can be large.
                currentSourcesByFile.delete(originalFile);
            }, 100);
        }
        source = await sourcePromise;
    }
    const ignorableFrame = {
        file: sourceFrame.file,
        line1: sourceFrame.line ?? null,
        column1: sourceFrame.column ?? null,
        methodName: // We ignore the sourcemapped name since it won't be the correct name.
        // The callsite will point to the column of the variable name instead of the
        // name of the enclosing function.
        // TODO(NDX-531): Spy on prepareStackTrace to get the enclosing line number for method name mapping.
        frame.methodName ?? '<unknown>',
        ignored,
        arguments: []
    };
    return {
        frame: ignorableFrame,
        source
    };
}
function parseFile(fileParam) {
    if (!fileParam) {
        return undefined;
    }
    return (0, _sourcemaps.devirtualizeReactServerURL)(fileParam);
}
function createStackFrames(body) {
    const { frames, isServer } = body;
    return frames.map((frame)=>{
        const file = parseFile(frame.file);
        if (!file) {
            return undefined;
        }
        return {
            file,
            methodName: frame.methodName ?? '<unknown>',
            line: frame.line1 ?? undefined,
            column: frame.column1 ?? undefined,
            isServer
        };
    }).filter((f)=>f !== undefined);
}
function createStackFrame(searchParams) {
    const file = parseFile(searchParams.get('file'));
    if (!file) {
        return undefined;
    }
    return {
        file,
        methodName: searchParams.get('methodName') ?? '<unknown>',
        line: parseInt(searchParams.get('line1') ?? '0', 10) || undefined,
        column: parseInt(searchParams.get('column1') ?? '0', 10) || undefined,
        isServer: searchParams.get('isServer') === 'true'
    };
}
/**
 * @returns 1-based lines and 1-based columns
 */ async function nativeTraceSource(frame) {
    const sourceURL = frame.file;
    let sourceMapPayload;
    try {
        var _findSourceMap;
        sourceMapPayload = (_findSourceMap = (0, _nodemodule.findSourceMap)(sourceURL)) == null ? void 0 : _findSourceMap.payload;
    } catch (cause) {
        throw Object.defineProperty(new Error(`${sourceURL}: Invalid source map. Only conformant source maps can be used to find the original code.`, {
            cause
        }), "__NEXT_ERROR_CODE", {
            value: "E635",
            enumerable: false,
            configurable: true
        });
    }
    if (sourceMapPayload !== undefined) {
        let consumer;
        try {
            consumer = await new _sourcemap08.SourceMapConsumer(sourceMapPayload);
        } catch (cause) {
            throw Object.defineProperty(new Error(`${sourceURL}: Invalid source map. Only conformant source maps can be used to find the original code.`, {
                cause
            }), "__NEXT_ERROR_CODE", {
                value: "E635",
                enumerable: false,
                configurable: true
            });
        }
        let traced;
        try {
            const originalPosition = consumer.originalPositionFor({
                line: frame.line ?? 1,
                // 0-based columns out requires 0-based columns in.
                column: (frame.column ?? 1) - 1
            });
            if (originalPosition.source === null) {
                traced = null;
            } else {
                const sourceContent = consumer.sourceContentFor(originalPosition.source, /* returnNullOnMissing */ true) ?? null;
                traced = {
                    originalPosition,
                    sourceContent
                };
            }
        } finally{
            consumer.destroy();
        }
        if (traced !== null) {
            var // We ignore the sourcemapped name since it won't be the correct name.
            // The callsite will point to the column of the variable name instead of the
            // name of the enclosing function.
            // TODO(NDX-531): Spy on prepareStackTrace to get the enclosing line number for method name mapping.
            _frame_methodName_replace, _frame_methodName;
            const { originalPosition, sourceContent } = traced;
            const applicableSourceMap = (0, _sourcemaps.findApplicableSourceMapPayload)((frame.line ?? 1) - 1, (frame.column ?? 1) - 1, sourceMapPayload);
            // TODO(veil): Upstream a method to sourcemap consumer that immediately says if a frame is ignored or not.
            let ignored = false;
            if (applicableSourceMap === undefined) {
                console.error('No applicable source map found in sections for frame', frame);
            } else {
                var _applicableSourceMap_ignoreList;
                // TODO: O(n^2). Consider moving `ignoreList` into a Set
                const sourceIndex = applicableSourceMap.sources.indexOf(originalPosition.source);
                ignored = ((_applicableSourceMap_ignoreList = applicableSourceMap.ignoreList) == null ? void 0 : _applicableSourceMap_ignoreList.includes(sourceIndex)) ?? // When sourcemap is not available, fallback to checking `frame.file`.
                // e.g. In pages router, nextjs server code is not bundled into the page.
                shouldIgnorePath(frame.file);
            }
            const originalStackFrame = {
                methodName: ((_frame_methodName = frame.methodName) == null ? void 0 : (_frame_methodName_replace = _frame_methodName.replace('__WEBPACK_DEFAULT_EXPORT__', 'default')) == null ? void 0 : _frame_methodName_replace.replace('__webpack_exports__.', '')) || '<unknown>',
                file: originalPosition.source,
                line1: originalPosition.line,
                column1: originalPosition.column === null ? null : originalPosition.column + 1,
                // TODO: c&p from async createOriginalStackFrame but why not frame.arguments?
                arguments: [],
                ignored
            };
            return {
                frame: originalStackFrame,
                source: sourceContent
            };
        }
    }
    return undefined;
}
async function createOriginalStackFrame(project, projectPath, frame) {
    const traced = await nativeTraceSource(frame) ?? // TODO(veil): When would the bundler know more than native?
    // If it's faster, try the bundler first and fall back to native later.
    await batchedTraceSource(project, frame);
    if (!traced) {
        return null;
    }
    let normalizedStackFrameLocation = traced.frame.file;
    if (normalizedStackFrameLocation !== null && normalizedStackFrameLocation.startsWith('file://')) {
        normalizedStackFrameLocation = _path.default.relative(projectPath, (0, _nodeurl.fileURLToPath)(normalizedStackFrameLocation));
    }
    /** undefined = not yet computed */ let originalCodeFrame;
    const tracedFrame = traced.frame;
    return {
        originalStackFrame: {
            arguments: tracedFrame.arguments,
            file: normalizedStackFrameLocation,
            line1: tracedFrame.line1,
            column1: tracedFrame.column1,
            ignored: tracedFrame.ignored,
            methodName: tracedFrame.methodName
        },
        get originalCodeFrame () {
            if (originalCodeFrame === undefined) {
                originalCodeFrame = (0, _shared.getOriginalCodeFrame)(tracedFrame, traced.source);
            }
            return originalCodeFrame;
        }
    };
}
function getOverlayMiddleware({ project, projectPath, isSrcDir }) {
    return async function(req, res, next) {
        const { pathname, searchParams } = new URL(req.url, 'http://n');
        if (pathname === '/__nextjs_original-stack-frames') {
            if (req.method !== 'POST') {
                return _middlewareresponse.middlewareResponse.badRequest(res);
            }
            const body = await new Promise((resolve, reject)=>{
                let data = '';
                req.on('data', (chunk)=>{
                    data += chunk;
                });
                req.on('end', ()=>resolve(data));
                req.on('error', reject);
            });
            const request = JSON.parse(body);
            const result = await getOriginalStackFrames({
                project,
                projectPath,
                frames: request.frames,
                isServer: request.isServer,
                isEdgeServer: request.isEdgeServer,
                isAppDirectory: request.isAppDirectory
            });
            (0, _shared.ignoreListAnonymousStackFramesIfSandwiched)(result);
            return _middlewareresponse.middlewareResponse.json(res, result);
        } else if (pathname === '/__nextjs_launch-editor') {
            const isAppRelativePath = searchParams.get('isAppRelativePath') === '1';
            let openEditorResult;
            if (isAppRelativePath) {
                const relativeFilePath = searchParams.get('file') || '';
                const appPath = _path.default.join('app', isSrcDir ? 'src' : '', relativeFilePath);
                openEditorResult = await (0, _launcheditor.openFileInEditor)(appPath, 1, 1, projectPath);
            } else {
                const frame = createStackFrame(searchParams);
                if (!frame) return _middlewareresponse.middlewareResponse.badRequest(res);
                openEditorResult = await (0, _launcheditor.openFileInEditor)(frame.file, frame.line ?? 1, frame.column ?? 1, projectPath);
            }
            if (openEditorResult.error) {
                return _middlewareresponse.middlewareResponse.internalServerError(res, openEditorResult.error);
            }
            if (!openEditorResult.found) {
                return _middlewareresponse.middlewareResponse.notFound(res);
            }
            return _middlewareresponse.middlewareResponse.noContent(res);
        }
        return next();
    };
}
function getSourceMapMiddleware(project) {
    return async function(req, res, next) {
        const { pathname, searchParams } = new URL(req.url, 'http://n');
        if (pathname !== '/__nextjs_source-map') {
            return next();
        }
        let filename = searchParams.get('filename');
        if (!filename) {
            return _middlewareresponse.middlewareResponse.badRequest(res);
        }
        let nativeSourceMap;
        try {
            nativeSourceMap = (0, _nodemodule.findSourceMap)(filename);
        } catch (cause) {
            return _middlewareresponse.middlewareResponse.internalServerError(res, Object.defineProperty(new Error(`${filename}: Invalid source map. Only conformant source maps can be used to find the original code.`, {
                cause
            }), "__NEXT_ERROR_CODE", {
                value: "E635",
                enumerable: false,
                configurable: true
            }));
        }
        if (nativeSourceMap !== undefined) {
            const sourceMapPayload = nativeSourceMap.payload;
            return _middlewareresponse.middlewareResponse.json(res, sourceMapPayload);
        }
        try {
            // Turbopack chunk filenames might be URL-encoded.
            filename = decodeURI(filename);
        } catch  {
            return _middlewareresponse.middlewareResponse.badRequest(res);
        }
        if (_path.default.isAbsolute(filename)) {
            filename = (0, _nodeurl.pathToFileURL)(filename).href;
        }
        try {
            const sourceMapString = await project.getSourceMap(filename);
            if (sourceMapString) {
                return _middlewareresponse.middlewareResponse.jsonString(res, sourceMapString);
            }
        } catch (cause) {
            return _middlewareresponse.middlewareResponse.internalServerError(res, Object.defineProperty(new Error(`Failed to get source map for '${filename}'. This is a bug in Next.js`, {
                cause
            }), "__NEXT_ERROR_CODE", {
                value: "E719",
                enumerable: false,
                configurable: true
            }));
        }
        _middlewareresponse.middlewareResponse.noContent(res);
    };
}
async function getOriginalStackFrames({ project, projectPath, frames, isServer, isEdgeServer, isAppDirectory }) {
    const stackFrames = createStackFrames({
        frames,
        isServer,
        isEdgeServer,
        isAppDirectory
    });
    return Promise.all(stackFrames.map(async (frame)=>{
        try {
            const stackFrame = await createOriginalStackFrame(project, projectPath, frame);
            if (stackFrame === null) {
                return {
                    status: 'rejected',
                    reason: 'Failed to create original stack frame'
                };
            }
            const originalStackFrame = stackFrame.originalStackFrame;
            return {
                status: 'fulfilled',
                value: {
                    originalStackFrame,
                    originalCodeFrame: (originalStackFrame == null ? void 0 : originalStackFrame.ignored) ?? true ? null : stackFrame.originalCodeFrame
                }
            };
        } catch (error) {
            return {
                status: 'rejected',
                reason: (0, _nodeutil.inspect)(error, {
                    colors: false
                })
            };
        }
    }));
}

//# sourceMappingURL=middleware-turbopack.js.map