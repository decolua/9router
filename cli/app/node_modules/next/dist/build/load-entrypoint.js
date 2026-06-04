"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "loadEntrypoint", {
    enumerable: true,
    get: function() {
        return loadEntrypoint;
    }
});
const _promises = /*#__PURE__*/ _interop_require_default(require("fs/promises"));
const _path = /*#__PURE__*/ _interop_require_default(require("path"));
const _swc = require("./swc");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
// NOTE: this should be updated if this loader file is moved.
const PACKAGE_ROOT = _path.default.normalize(_path.default.join(__dirname, '../..'));
const TEMPLATE_SRC_FOLDER = _path.default.normalize(_path.default.join(__dirname, './templates'));
const TEMPLATES_ESM_FOLDER = _path.default.normalize(_path.default.join(__dirname, '../../dist/esm/build/templates'));
async function loadEntrypoint(entrypoint, replacements, injections, imports) {
    const templatePath = _path.default.resolve(_path.default.join(TEMPLATES_ESM_FOLDER, `${entrypoint}.js`));
    let content = await _promises.default.readFile(templatePath);
    return (0, _swc.getBindingsSync)().expandNextJsTemplate(content, // Ensure that we use unix-style path separators for the import paths
    _path.default.join(TEMPLATE_SRC_FOLDER, `${entrypoint}.js`).replace(/\\/g, '/'), PACKAGE_ROOT.replace(/\\/g, '/'), replacements, injections ?? {}, imports ?? {});
}

//# sourceMappingURL=load-entrypoint.js.map