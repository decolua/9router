"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    ModuleBuildError: null,
    formatIssue: null,
    getIssueKey: null,
    isFileSystemCacheEnabledForDev: null,
    isRelevantWarning: null,
    isWellKnownError: null,
    processIssues: null,
    renderStyledStringToErrorAnsi: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    ModuleBuildError: function() {
        return ModuleBuildError;
    },
    formatIssue: function() {
        return formatIssue;
    },
    getIssueKey: function() {
        return getIssueKey;
    },
    isFileSystemCacheEnabledForDev: function() {
        return isFileSystemCacheEnabledForDev;
    },
    isRelevantWarning: function() {
        return isRelevantWarning;
    },
    isWellKnownError: function() {
        return isWellKnownError;
    },
    processIssues: function() {
        return processIssues;
    },
    renderStyledStringToErrorAnsi: function() {
        return renderStyledStringToErrorAnsi;
    }
});
const _interop_require_wildcard = require("@swc/helpers/_/_interop_require_wildcard");
const _picocolors = require("../../../lib/picocolors");
const _magicidentifier = require("../magic-identifier");
const _log = /*#__PURE__*/ _interop_require_wildcard._(require("../../../build/output/log"));
const VERBOSE_ISSUES = !!process.env.NEXT_TURBOPACK_VERBOSE_ISSUES;
class ModuleBuildError extends Error {
    constructor(...args){
        super(...args), this.name = 'ModuleBuildError';
    }
}
function isWellKnownError(issue) {
    const { title } = issue;
    const formattedTitle = renderStyledStringToErrorAnsi(title);
    // TODO: add more well known errors
    if (formattedTitle.includes('Module not found') || formattedTitle.includes('Unknown module type')) {
        return true;
    }
    return false;
}
function getIssueKey(issue) {
    return `${issue.severity}-${issue.filePath}-${JSON.stringify(issue.title)}-${JSON.stringify(issue.description)}`;
}
function processIssues(currentEntryIssues, key, result, throwIssue, logErrors) {
    const newIssues = new Map();
    currentEntryIssues.set(key, newIssues);
    const relevantIssues = new Set();
    for (const issue of result.issues){
        if (issue.severity !== 'error' && issue.severity !== 'fatal' && issue.severity !== 'warning') continue;
        const issueKey = getIssueKey(issue);
        newIssues.set(issueKey, issue);
        if (issue.severity !== 'warning') {
            if (throwIssue) {
                const formatted = formatIssue(issue);
                relevantIssues.add(formatted);
            } else if (logErrors && isWellKnownError(issue)) {
                const formatted = formatIssue(issue);
                _log.error(formatted);
            }
        }
    }
    if (relevantIssues.size && throwIssue) {
        throw Object.defineProperty(new ModuleBuildError([
            ...relevantIssues
        ].join('\n\n')), "__NEXT_ERROR_CODE", {
            value: "E394",
            enumerable: false,
            configurable: true
        });
    }
}
function formatFilePath(filePath) {
    return filePath.replace('[project]/', './').replaceAll('/./', '/').replace('\\\\?\\', '');
}
function formatIssue(issue) {
    const { filePath, title, description, detail, source, importTraces } = issue;
    let { documentationLink } = issue;
    const formattedTitle = renderStyledStringToErrorAnsi(title).replace(/\n/g, '\n    ');
    // TODO: Use error codes to identify these
    // TODO: Generalize adapting Turbopack errors to Next.js errors
    if (formattedTitle.includes('Module not found')) {
        // For compatiblity with webpack
        // TODO: include columns in webpack errors.
        documentationLink = 'https://nextjs.org/docs/messages/module-not-found';
    }
    const formattedFilePath = formatFilePath(filePath);
    let message = '';
    if (source?.range) {
        const { start } = source.range;
        message = `${formattedFilePath}:${start.line + 1}:${start.column + 1}\n${formattedTitle}`;
    } else if (formattedFilePath) {
        message = `${formattedFilePath}\n${formattedTitle}`;
    } else {
        message = formattedTitle;
    }
    message += '\n';
    if (issue.codeFrame) {
        message += issue.codeFrame.trimEnd() + '\n\n';
    }
    if (description) {
        if (description.type === 'text' && description.value.includes(`Cannot find module 'sass'`)) {
            message += "To use Next.js' built-in Sass support, you first need to install `sass`.\n";
            message += 'Run `npm i sass` or `yarn add sass` inside your workspace.\n';
            message += '\nLearn more: https://nextjs.org/docs/messages/install-sass\n';
        } else {
            message += renderStyledStringToErrorAnsi(description) + '\n\n';
        }
    }
    // TODO: make it easier to enable this for debugging
    if (VERBOSE_ISSUES && detail) {
        message += renderStyledStringToErrorAnsi(detail) + '\n\n';
    }
    // Render additional sources (e.g., generated code from a loader)
    for (const additional of issue.additionalSources ?? []){
        if (additional.codeFrame) {
            const additionalFilePath = formatFilePath(additional.source.source.filePath);
            const loc = additional.source.range ? `:${additional.source.range.start.line + 1}:${additional.source.range.start.column + 1}` : '';
            message += `${additional.description}:\n${additionalFilePath}${loc}\n${additional.codeFrame.trimEnd()}\n\n`;
        }
    }
    if (importTraces?.length) {
        // This is the same logic as in turbopack/crates/turbopack-cli-utils/src/issue.rs
        // We end up with multiple traces when the file with the error is reachable from multiple
        // different entry points (e.g. ssr, client)
        message += `Import trace${importTraces.length > 1 ? 's' : ''}:\n`;
        const everyTraceHasADistinctRootLayer = new Set(importTraces.map(leafLayerName).filter((l)=>l != null)).size === importTraces.length;
        for(let i = 0; i < importTraces.length; i++){
            const trace = importTraces[i];
            const layer = leafLayerName(trace);
            let traceIndent = '    ';
            // If this is true, layer must be present
            if (everyTraceHasADistinctRootLayer) {
                message += `  ${layer}:\n`;
            } else {
                if (importTraces.length > 1) {
                    // Otherwise use simple 1 based indices to disambiguate
                    message += `  #${i + 1}`;
                    if (layer) {
                        message += ` [${layer}]`;
                    }
                    message += ':\n';
                } else if (layer) {
                    message += ` [${layer}]:\n`;
                } else {
                    // If there is a single trace and no layer name just don't indent it.
                    traceIndent = '  ';
                }
            }
            message += formatIssueTrace(trace, traceIndent, !identicalLayers(trace));
        }
    }
    if (documentationLink) {
        message += documentationLink + '\n\n';
    }
    return message;
}
/** Returns the first present layer name in the trace */ function leafLayerName(items) {
    for (const item of items){
        const layer = item.layer;
        if (layer != null) return layer;
    }
    return undefined;
}
/**
 * Returns whether or not all items share the same layer.
 * If a layer is absent we ignore it in this analysis
 */ function identicalLayers(items) {
    const firstPresentLayer = items.findIndex((t)=>t.layer != null);
    if (firstPresentLayer === -1) return true // all layers are absent
    ;
    const layer = items[firstPresentLayer].layer;
    for(let i = firstPresentLayer + 1; i < items.length; i++){
        const itemLayer = items[i].layer;
        if (itemLayer == null || itemLayer !== layer) {
            return false;
        }
    }
    return true;
}
function formatIssueTrace(items, indent, printLayers) {
    return `${items.map((item)=>{
        let r = indent;
        if (item.fsName !== 'project') {
            r += `[${item.fsName}]/`;
        } else {
            // This is consistent with webpack's output
            r += './';
        }
        r += item.path;
        if (printLayers && item.layer) {
            r += ` [${item.layer}]`;
        }
        return r;
    }).join('\n')}\n\n`;
}
function isRelevantWarning(issue) {
    return issue.severity === 'warning' && !isNodeModulesIssue(issue);
}
function isNodeModulesIssue(issue) {
    if (issue.severity === 'warning' && issue.stage === 'config') {
        // Override for the externalize issue
        // `Package foo (serverExternalPackages or default list) can't be external`
        if (renderStyledStringToErrorAnsi(issue.title).includes("can't be external")) {
            return false;
        }
    }
    return issue.severity === 'warning' && (issue.filePath.match(/^(?:.*[\\/])?node_modules(?:[\\/].*)?$/) !== null || // Ignore Next.js itself when running next directly in the monorepo where it is not inside
    // node_modules anyway.
    // TODO(mischnic) prevent matches when this is published to npm
    issue.filePath.startsWith('[project]/packages/next/'));
}
function renderStyledStringToErrorAnsi(string) {
    function applyDeobfuscation(str) {
        // Use shared deobfuscate function and apply magenta color to identifiers
        const deobfuscated = (0, _magicidentifier.deobfuscateText)(str);
        // Color any {...} wrapped identifiers with magenta
        return deobfuscated.replace(/\{([^}]+)\}/g, (match)=>(0, _picocolors.magenta)(match));
    }
    switch(string.type){
        case 'text':
            return applyDeobfuscation(string.value);
        case 'strong':
            return (0, _picocolors.bold)((0, _picocolors.red)(applyDeobfuscation(string.value)));
        case 'code':
            return (0, _picocolors.green)(applyDeobfuscation(string.value));
        case 'line':
            return string.value.map(renderStyledStringToErrorAnsi).join('');
        case 'stack':
            return string.value.map(renderStyledStringToErrorAnsi).join('\n');
        default:
            throw Object.defineProperty(new Error('Unknown StyledString type', string), "__NEXT_ERROR_CODE", {
                value: "E138",
                enumerable: false,
                configurable: true
            });
    }
}
function isFileSystemCacheEnabledForDev(config) {
    return config.experimental?.turbopackFileSystemCacheForDev || false;
}

//# sourceMappingURL=utils.js.map