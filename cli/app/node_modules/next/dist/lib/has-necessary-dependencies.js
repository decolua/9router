"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "hasNecessaryDependencies", {
    enumerable: true,
    get: function() {
        return hasNecessaryDependencies;
    }
});
const _fs = require("fs");
const _resolvefrom = require("./resolve-from");
const _path = require("path");
function hasNecessaryDependencies(baseDir, requiredPackages) {
    let resolutions = new Map();
    const missingPackages = [];
    for (const p of requiredPackages){
        try {
            const pkgPath = (0, _fs.realpathSync)((0, _resolvefrom.resolveFrom)(baseDir, `${p.pkg}/package.json`));
            const pkgDir = (0, _path.dirname)(pkgPath);
            resolutions.set((0, _path.join)(p.pkg, 'package.json'), pkgPath);
            if (p.exportsRestrict) {
                const fileNameToVerify = (0, _path.relative)(p.pkg, p.file);
                if (fileNameToVerify) {
                    const fileToVerify = (0, _path.join)(pkgDir, fileNameToVerify);
                    if ((0, _fs.existsSync)(fileToVerify)) {
                        resolutions.set(p.pkg, fileToVerify);
                    } else {
                        missingPackages.push(p);
                        continue;
                    }
                } else {
                    resolutions.set(p.pkg, pkgPath);
                }
            } else {
                resolutions.set(p.pkg, (0, _resolvefrom.resolveFrom)(baseDir, p.file));
            }
        } catch (_) {
            missingPackages.push(p);
            continue;
        }
    }
    return {
        resolved: resolutions,
        missing: missingPackages
    };
}

//# sourceMappingURL=has-necessary-dependencies.js.map