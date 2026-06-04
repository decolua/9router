"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "getSourceMapFromFile", {
    enumerable: true,
    get: function() {
        return getSourceMapFromFile;
    }
});
const _promises = /*#__PURE__*/ _interop_require_default(require("fs/promises"));
const _path = /*#__PURE__*/ _interop_require_default(require("path"));
const _url = /*#__PURE__*/ _interop_require_default(require("url"));
const _datauritobuffer = /*#__PURE__*/ _interop_require_default(require("next/dist/compiled/data-uri-to-buffer"));
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
function getSourceMapUrl(fileContents) {
    const regex = /\/\/[#@] ?sourceMappingURL=([^\s'"]+)\s*$/gm;
    let match = null;
    for(;;){
        let next = regex.exec(fileContents);
        if (next == null) {
            break;
        }
        match = next;
    }
    if (!(match && match[1])) {
        return null;
    }
    return match[1].toString();
}
async function getSourceMapFromFile(filename) {
    filename = filename.startsWith('file://') ? _url.default.fileURLToPath(filename) : filename;
    let fileContents;
    try {
        fileContents = await _promises.default.readFile(filename, 'utf-8');
    } catch (error) {
        throw Object.defineProperty(new Error(`Failed to read file contents of ${filename}.`, {
            cause: error
        }), "__NEXT_ERROR_CODE", {
            value: "E466",
            enumerable: false,
            configurable: true
        });
    }
    const sourceUrl = getSourceMapUrl(fileContents);
    if (!sourceUrl) {
        return undefined;
    }
    if (sourceUrl.startsWith('data:')) {
        let buffer;
        try {
            buffer = (0, _datauritobuffer.default)(sourceUrl);
        } catch (error) {
            throw Object.defineProperty(new Error(`Failed to parse source map URL for ${filename}.`, {
                cause: error
            }), "__NEXT_ERROR_CODE", {
                value: "E199",
                enumerable: false,
                configurable: true
            });
        }
        if (buffer.type !== 'application/json') {
            throw Object.defineProperty(new Error(`Unknown source map type for ${filename}: ${buffer.typeFull}.`), "__NEXT_ERROR_CODE", {
                value: "E113",
                enumerable: false,
                configurable: true
            });
        }
        try {
            return JSON.parse(buffer.toString());
        } catch (error) {
            throw Object.defineProperty(new Error(`Failed to parse source map for ${filename}.`, {
                cause: error
            }), "__NEXT_ERROR_CODE", {
                value: "E318",
                enumerable: false,
                configurable: true
            });
        }
    }
    const sourceMapFilename = _path.default.resolve(_path.default.dirname(filename), decodeURIComponent(sourceUrl));
    try {
        const sourceMapContents = await _promises.default.readFile(sourceMapFilename, 'utf-8');
        return JSON.parse(sourceMapContents.toString());
    } catch (error) {
        throw Object.defineProperty(new Error(`Failed to parse source map ${sourceMapFilename}.`, {
            cause: error
        }), "__NEXT_ERROR_CODE", {
            value: "E220",
            enumerable: false,
            configurable: true
        });
    }
}

//# sourceMappingURL=get-source-map-from-file.js.map