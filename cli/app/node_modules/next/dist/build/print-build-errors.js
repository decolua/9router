"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "printBuildErrors", {
    enumerable: true,
    get: function() {
        return printBuildErrors;
    }
});
const _utils = require("../shared/lib/turbopack/utils");
function printBuildErrors(entrypoints, isDev) {
    // Issues that we want to stop the server from executing
    const topLevelFatalIssues = [];
    // Issues that are true errors, but we believe we can keep running and allow the user to address the issue
    const topLevelErrors = [];
    // Issues that are warnings but should not affect the running of the build
    const topLevelWarnings = [];
    // Track seen formatted error messages to avoid duplicates
    const seenFatalIssues = new Set();
    const seenErrors = new Set();
    const seenWarnings = new Set();
    for (const issue of entrypoints.issues){
        // We only want to completely shut down the server
        if (issue.severity === 'fatal' || issue.severity === 'bug') {
            const formatted = (0, _utils.formatIssue)(issue);
            if (!seenFatalIssues.has(formatted)) {
                seenFatalIssues.add(formatted);
                topLevelFatalIssues.push(formatted);
            }
        } else if ((0, _utils.isRelevantWarning)(issue)) {
            const formatted = (0, _utils.formatIssue)(issue);
            if (!seenWarnings.has(formatted)) {
                seenWarnings.add(formatted);
                topLevelWarnings.push(formatted);
            }
        } else if (issue.severity === 'error') {
            const formatted = (0, _utils.formatIssue)(issue);
            if (isDev) {
                // We want to treat errors as recoverable in development
                // so that we can show the errors in the site and allow users
                // to respond to the errors when necessary. In production builds
                // though we want to error out and stop the build process.
                if (!seenErrors.has(formatted)) {
                    seenErrors.add(formatted);
                    topLevelErrors.push(formatted);
                }
            } else {
                if (!seenFatalIssues.has(formatted)) {
                    seenFatalIssues.add(formatted);
                    topLevelFatalIssues.push(formatted);
                }
            }
        }
    }
    // TODO: print in order by source location so issues from the same file are displayed together and then add a summary at the end about the number of warnings/errors
    if (topLevelWarnings.length > 0) {
        console.warn(`Turbopack build encountered ${topLevelWarnings.length} warnings:\n${topLevelWarnings.join('\n')}`);
    }
    if (topLevelErrors.length > 0) {
        console.error(`Turbopack build encountered ${topLevelErrors.length} errors:\n${topLevelErrors.join('\n')}`);
    }
    if (topLevelFatalIssues.length > 0) {
        throw Object.defineProperty(new Error(`Turbopack build failed with ${topLevelFatalIssues.length} errors:\n${topLevelFatalIssues.join('\n')}`), "__NEXT_ERROR_CODE", {
            value: "E425",
            enumerable: false,
            configurable: true
        });
    }
}

//# sourceMappingURL=print-build-errors.js.map