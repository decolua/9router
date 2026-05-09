"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "writeAppTypeDeclarations", {
    enumerable: true,
    get: function() {
        return writeAppTypeDeclarations;
    }
});
const _os = /*#__PURE__*/ _interop_require_default(require("os"));
const _path = /*#__PURE__*/ _interop_require_default(require("path"));
const _fs = require("fs");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
async function writeAppTypeDeclarations({ baseDir, distDir, imageImportsEnabled, hasPagesDir, hasAppDir, strictRouteTypes, typedRoutes }) {
    // Reference `next` types
    const appTypeDeclarations = _path.default.join(baseDir, 'next-env.d.ts');
    // Defaults EOL to system default
    let eol = _os.default.EOL;
    let currentContent;
    try {
        currentContent = await _fs.promises.readFile(appTypeDeclarations, 'utf8');
        // If file already exists then preserve its line ending
        const lf = currentContent.indexOf('\n', /* skip first so we can lf - 1 */ 1);
        if (lf !== -1) {
            if (currentContent[lf - 1] === '\r') {
                eol = '\r\n';
            } else {
                eol = '\n';
            }
        }
    } catch  {}
    /**
   * "Triple-slash directives" used to create typings files for Next.js projects
   * using Typescript .
   *
   * @see https://www.typescriptlang.org/docs/handbook/triple-slash-directives.html
   */ const lines = [
        // Include the core Next.js typings.
        '/// <reference types="next" />'
    ];
    if (imageImportsEnabled) {
        lines.push('/// <reference types="next/image-types/global" />');
    }
    if (hasAppDir && hasPagesDir) {
        lines.push('/// <reference types="next/navigation-types/compat/navigation" />');
    }
    const routeTypesPath = _path.default.posix.join(distDir.replaceAll(_path.default.win32.sep, _path.default.posix.sep), 'types/routes.d.ts');
    // Use ESM import instead of triple-slash reference for better ESLint compatibility
    lines.push(`import "./${routeTypesPath}";`);
    if (strictRouteTypes) {
        const cacheLifePath = _path.default.posix.join(distDir.replaceAll(_path.default.win32.sep, _path.default.posix.sep), 'types/cache-life.d.ts');
        lines.push(`import "./${cacheLifePath}";`);
        const routeValidatorPath = _path.default.posix.join(distDir.replaceAll(_path.default.win32.sep, _path.default.posix.sep), 'types/validator.ts');
        lines.push(`import "./${routeValidatorPath}";`);
        if (typedRoutes === true) {
            const linkTypesPath = _path.default.posix.join(distDir.replaceAll(_path.default.win32.sep, _path.default.posix.sep), 'types/link.d.ts');
            lines.push(`import "./${linkTypesPath}";`);
        }
    }
    // Push the notice in.
    lines.push('', '// NOTE: This file should not be edited', `// see https://nextjs.org/docs/${hasAppDir ? 'app' : 'pages'}/api-reference/config/typescript for more information.`);
    const content = lines.join(eol) + eol;
    // Avoids an un-necessary write on read-only fs
    if (currentContent === content) {
        return;
    }
    await _fs.promises.writeFile(appTypeDeclarations, content);
}

//# sourceMappingURL=writeAppTypeDeclarations.js.map