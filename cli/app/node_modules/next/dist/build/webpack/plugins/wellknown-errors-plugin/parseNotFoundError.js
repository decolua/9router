"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    getImageError: null,
    getNotFoundError: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    getImageError: function() {
        return getImageError;
    },
    getNotFoundError: function() {
        return getNotFoundError;
    }
});
const _picocolors = require("../../../../lib/picocolors");
const _simpleWebpackError = require("./simpleWebpackError");
const _middlewarewebpack = require("../../../../server/dev/middleware-webpack");
const _isinternal = /*#__PURE__*/ _interop_require_default(require("../../../../shared/lib/is-internal"));
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
// Based on https://github.com/webpack/webpack/blob/fcdd04a833943394bbb0a9eeb54a962a24cc7e41/lib/stats/DefaultStatsFactoryPlugin.js#L422-L431
/*
Copyright JS Foundation and other contributors

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
'Software'), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

*/ function getModuleTrace(input, compilation) {
    const visitedModules = new Set();
    const moduleTrace = [];
    let current = input.module;
    while(current){
        if (visitedModules.has(current)) break; // circular (technically impossible, but who knows)
        visitedModules.add(current);
        const origin = compilation.moduleGraph.getIssuer(current);
        if (!origin) break;
        moduleTrace.push({
            origin,
            module: current
        });
        current = origin;
    }
    return moduleTrace;
}
function sourceMapIgnoreListsEverything(sourceMap) {
    var _sourceMap_ignoreList;
    return sourceMap.sources.length === ((_sourceMap_ignoreList = sourceMap.ignoreList) == null ? void 0 : _sourceMap_ignoreList.length);
}
async function getSourceFrame(input, fileName, compilation) {
    try {
        const loc = input.loc || input.dependencies.map((d)=>d.loc).filter(Boolean)[0];
        const module1 = input.module;
        const originalSource = module1.originalSource();
        const sourceMap = (originalSource == null ? void 0 : originalSource.map()) ?? undefined;
        if (sourceMap) {
            var _originalStackFrame_line1, _originalStackFrame_column1;
            const moduleId = compilation.chunkGraph.getModuleId(module1);
            const result = await (0, _middlewarewebpack.createOriginalStackFrame)({
                ignoredByDefault: sourceMapIgnoreListsEverything(sourceMap),
                source: {
                    type: 'bundle',
                    sourceMap,
                    ignoredSources: (0, _middlewarewebpack.getIgnoredSources)(sourceMap),
                    compilation,
                    moduleId,
                    moduleURL: fileName
                },
                rootDirectory: compilation.options.context,
                frame: {
                    arguments: [],
                    file: fileName,
                    methodName: '',
                    line1: loc.start.line,
                    // loc is 0-based but columns in stack frames are 1-based.
                    column1: (loc.start.column ?? 0) + 1
                }
            });
            if (result === null || result.originalStackFrame === null) {
                return {
                    column1: '',
                    frame: '',
                    line1: ''
                };
            }
            const originalStackFrame = result.originalStackFrame;
            return {
                frame: (!(0, _isinternal.default)(originalStackFrame.file) ? result.originalCodeFrame : null) ?? '',
                line1: ((_originalStackFrame_line1 = originalStackFrame.line1) == null ? void 0 : _originalStackFrame_line1.toString()) ?? '',
                column1: ((_originalStackFrame_column1 = originalStackFrame.column1) == null ? void 0 : _originalStackFrame_column1.toString()) ?? ''
            };
        }
    } catch  {}
    return {
        frame: '',
        line1: '',
        column1: ''
    };
}
function getFormattedFileName(fileName, module1, lineNumber, column) {
    var _module_loaders;
    if ((_module_loaders = module1.loaders) == null ? void 0 : _module_loaders.find((loader)=>/next-font-loader[/\\]index.js/.test(loader.loader))) {
        // Parse the query and get the path of the file where the font function was called.
        // provided by next-swc next-transform-font
        return JSON.parse(module1.resourceResolveData.query.slice(1)).path;
    } else {
        let formattedFileName = (0, _picocolors.cyan)(fileName);
        if (lineNumber && column) {
            formattedFileName += `:${(0, _picocolors.yellow)(lineNumber)}:${(0, _picocolors.yellow)(column)}`;
        }
        return formattedFileName;
    }
}
async function getNotFoundError(compilation, input, fileName, module1) {
    if (input.name !== 'ModuleNotFoundError' && !(input.name === 'ModuleBuildError' && /Error: Can't resolve '.+' in /.test(input.message))) {
        return false;
    }
    try {
        const { frame, line1, column1 } = await getSourceFrame(input, fileName, compilation);
        const errorMessage = input.error.message.replace(/ in '.*?'/, '').replace(/Can't resolve '(.*)'/, `Can't resolve '${(0, _picocolors.green)('$1')}'`);
        const importTrace = ()=>{
            const moduleTrace = getModuleTrace(input, compilation).map(({ origin })=>origin.readableIdentifier(compilation.requestShortener)).filter((name)=>name && !/next-(app|middleware|client-pages|route|flight-(client|server|client-entry))-loader/.test(name) && !/css-loader.+\.js/.test(name));
            if (moduleTrace.length === 0) return '';
            return `\nImport trace for requested module:\n${moduleTrace.join('\n')}`;
        };
        let message = (0, _picocolors.red)((0, _picocolors.bold)('Module not found')) + `: ${errorMessage}` + '\n' + frame + (frame !== '' ? '\n' : '') + '\nhttps://nextjs.org/docs/messages/module-not-found\n' + importTrace();
        const formattedFileName = getFormattedFileName(fileName, module1, line1, column1);
        return new _simpleWebpackError.SimpleWebpackError(formattedFileName, message);
    } catch (err) {
        // Don't fail on failure to resolve sourcemaps
        return input;
    }
}
async function getImageError(compilation, input, err) {
    if (err.name !== 'InvalidImageFormatError') {
        return false;
    }
    const moduleTrace = getModuleTrace(input, compilation);
    const { origin, module: module1 } = moduleTrace[0] || {};
    if (!origin || !module1) {
        return false;
    }
    const page = origin.rawRequest.replace(/^private-next-pages/, './pages');
    const importedFile = module1.rawRequest;
    const source = origin.originalSource().buffer().toString('utf8');
    let lineNumber = -1;
    source.split('\n').some((line)=>{
        lineNumber++;
        return line.includes(importedFile);
    });
    return new _simpleWebpackError.SimpleWebpackError(`${(0, _picocolors.cyan)(page)}:${(0, _picocolors.yellow)(lineNumber.toString())}`, (0, _picocolors.red)((0, _picocolors.bold)('Error')).concat(`: Image import "${importedFile}" is not a valid image file. The image may be corrupted or an unsupported format.`));
}

//# sourceMappingURL=parseNotFoundError.js.map