"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    BOUNDARY_PREFIX: null,
    BOUNDARY_SUFFIX: null,
    BUILTIN_PREFIX: null,
    getBoundaryOriginFileType: null,
    getConventionPathByType: null,
    isBoundaryFile: null,
    isBuiltinBoundaryFile: null,
    isNextjsBuiltinFilePath: null,
    normalizeBoundaryFilename: null,
    normalizeConventionFilePath: null,
    normalizeFilePath: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    BOUNDARY_PREFIX: function() {
        return BOUNDARY_PREFIX;
    },
    BOUNDARY_SUFFIX: function() {
        return BOUNDARY_SUFFIX;
    },
    BUILTIN_PREFIX: function() {
        return BUILTIN_PREFIX;
    },
    getBoundaryOriginFileType: function() {
        return getBoundaryOriginFileType;
    },
    getConventionPathByType: function() {
        return getConventionPathByType;
    },
    isBoundaryFile: function() {
        return isBoundaryFile;
    },
    isBuiltinBoundaryFile: function() {
        return isBuiltinBoundaryFile;
    },
    isNextjsBuiltinFilePath: function() {
        return isNextjsBuiltinFilePath;
    },
    normalizeBoundaryFilename: function() {
        return normalizeBoundaryFilename;
    },
    normalizeConventionFilePath: function() {
        return normalizeConventionFilePath;
    },
    normalizeFilePath: function() {
        return normalizeFilePath;
    }
});
const BUILTIN_PREFIX = '__next_builtin__';
const nextInternalPrefixRegex = /^(.*[\\/])?next[\\/]dist[\\/]client[\\/]components[\\/]builtin[\\/]/;
function normalizeFilePath(projectDir, filePath) {
    // Turbopack project path is formed as: "<project root>/<cwd>".
    // When project root is not the working directory, we can extract the relative project root path.
    // This is mostly used for running Next.js inside a monorepo.
    const cwd = process.env.NEXT_RUNTIME === 'edge' ? '' : process.cwd();
    const relativeProjectRoot = projectDir.replace(cwd, '').replace(/^[\\/]/, '');
    let relativePath = (filePath || '')// remove turbopack [project] prefix
    .replace(/^\[project\][\\/]?/, '')// remove the project root from the path (absolute)
    .replace(projectDir, '')// remove cwd prefix (absolute)
    .replace(cwd, '')// normalize path separators and remove leading slash
    .replace(/\\/g, '/').replace(/^\//, '');
    // remove relative project path prefix (e.g., "test/e2e/app-dir/actions/")
    if (relativeProjectRoot && relativePath.startsWith(relativeProjectRoot)) {
        relativePath = relativePath.slice(relativeProjectRoot.length).replace(/^\//, '');
    }
    // Handle case where filename is relative to a parent of projectDir
    // (e.g., in tests where filename is "test/tmp/next-test-XXX/app/page.js"
    // but projectDir is the test temp directory)
    if (relativePath.includes('/')) {
        const projectDirName = projectDir.split(/[\\/]/).pop() || '';
        if (projectDirName) {
            const projectDirWithSlash = projectDirName + '/';
            const idx = relativePath.indexOf(projectDirWithSlash);
            if (idx >= 0) {
                relativePath = relativePath.slice(idx + projectDirWithSlash.length);
            }
        }
    }
    return relativePath;
}
function normalizeConventionFilePath(projectDir, conventionPath) {
    let relativePath = normalizeFilePath(projectDir, conventionPath)// remove /(src/)?app/ dir prefix
    .replace(/^(src\/)?app\//, '');
    // If it's internal file only keep the filename, strip nextjs internal prefix
    if (nextInternalPrefixRegex.test(relativePath)) {
        relativePath = relativePath.replace(nextInternalPrefixRegex, '');
        // Add a special prefix to let segment explorer know it's a built-in component
        relativePath = `${BUILTIN_PREFIX}${relativePath}`;
    }
    return relativePath;
}
const isNextjsBuiltinFilePath = (filePath)=>{
    return nextInternalPrefixRegex.test(filePath);
};
const BOUNDARY_SUFFIX = '@boundary';
function normalizeBoundaryFilename(filename) {
    return filename.replace(new RegExp(`^${BUILTIN_PREFIX}`), '').replace(new RegExp(`${BOUNDARY_SUFFIX}$`), '');
}
const BOUNDARY_PREFIX = 'boundary:';
function isBoundaryFile(fileType) {
    return fileType.startsWith(BOUNDARY_PREFIX);
}
function isBuiltinBoundaryFile(fileType) {
    return fileType.startsWith(BUILTIN_PREFIX);
}
function getBoundaryOriginFileType(fileType) {
    return fileType.replace(BOUNDARY_PREFIX, '');
}
function getConventionPathByType(tree, dir, conventionType) {
    const modules = tree[2];
    const conventionPath = modules[conventionType] ? modules[conventionType][1] : undefined;
    if (conventionPath) {
        return normalizeConventionFilePath(dir, conventionPath);
    }
    return undefined;
}

//# sourceMappingURL=segment-explorer-path.js.map