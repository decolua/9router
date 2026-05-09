"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "getTypeScriptConfiguration", {
    enumerable: true,
    get: function() {
        return getTypeScriptConfiguration;
    }
});
const _picocolors = require("../picocolors");
const _os = /*#__PURE__*/ _interop_require_default(require("os"));
const _path = /*#__PURE__*/ _interop_require_default(require("path"));
const _fatalerror = require("../fatal-error");
const _iserror = /*#__PURE__*/ _interop_require_default(require("../is-error"));
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
async function getTypeScriptConfiguration(typescript, tsConfigPath, metaOnly) {
    try {
        var _result_errors;
        const formatDiagnosticsHost = {
            getCanonicalFileName: (fileName)=>fileName,
            getCurrentDirectory: typescript.sys.getCurrentDirectory,
            getNewLine: ()=>_os.default.EOL
        };
        const { config, error } = typescript.readConfigFile(tsConfigPath, typescript.sys.readFile);
        if (error) {
            throw Object.defineProperty(new _fatalerror.FatalError(typescript.formatDiagnostic(error, formatDiagnosticsHost)), "__NEXT_ERROR_CODE", {
                value: "E394",
                enumerable: false,
                configurable: true
            });
        }
        let configToParse = config;
        const result = typescript.parseJsonConfigFileContent(configToParse, // When only interested in meta info,
        // avoid enumerating all files (for performance reasons)
        metaOnly ? {
            ...typescript.sys,
            readDirectory (_path, extensions, _excludes, _includes, _depth) {
                return [
                    extensions ? `file${extensions[0]}` : `file.ts`
                ];
            }
        } : typescript.sys, _path.default.dirname(tsConfigPath));
        if (result.errors) {
            result.errors = result.errors.filter(({ code })=>// No inputs were found in config file
                code !== 18003);
        }
        if ((_result_errors = result.errors) == null ? void 0 : _result_errors.length) {
            throw Object.defineProperty(new _fatalerror.FatalError(typescript.formatDiagnostic(result.errors[0], formatDiagnosticsHost)), "__NEXT_ERROR_CODE", {
                value: "E394",
                enumerable: false,
                configurable: true
            });
        }
        return result;
    } catch (err) {
        if ((0, _iserror.default)(err) && err.name === 'SyntaxError') {
            const reason = '\n' + (err.message ?? '');
            throw Object.defineProperty(new _fatalerror.FatalError((0, _picocolors.bold)('Could not parse' + (0, _picocolors.cyan)('tsconfig.json') + '.' + ' Please make sure it contains syntactically correct JSON.') + reason), "__NEXT_ERROR_CODE", {
                value: "E1023",
                enumerable: false,
                configurable: true
            });
        }
        throw err;
    }
}

//# sourceMappingURL=getTypeScriptConfiguration.js.map