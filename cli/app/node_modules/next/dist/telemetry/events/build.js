"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    ERROR_THROWN_EVENT: null,
    EVENT_BUILD_FEATURE_USAGE: null,
    EVENT_MCP_TOOL_USAGE: null,
    EVENT_NAME_PACKAGE_USED_IN_GET_SERVER_SIDE_PROPS: null,
    eventAnalyzeCompleted: null,
    eventBuildCompleted: null,
    eventBuildFailed: null,
    eventBuildFeatureUsage: null,
    eventBuildOptimize: null,
    eventErrorThrown: null,
    eventLintCheckCompleted: null,
    eventMcpToolUsage: null,
    eventPackageUsedInGetServerSideProps: null,
    eventTypeCheckCompleted: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    ERROR_THROWN_EVENT: function() {
        return ERROR_THROWN_EVENT;
    },
    EVENT_BUILD_FEATURE_USAGE: function() {
        return EVENT_BUILD_FEATURE_USAGE;
    },
    EVENT_MCP_TOOL_USAGE: function() {
        return EVENT_MCP_TOOL_USAGE;
    },
    EVENT_NAME_PACKAGE_USED_IN_GET_SERVER_SIDE_PROPS: function() {
        return EVENT_NAME_PACKAGE_USED_IN_GET_SERVER_SIDE_PROPS;
    },
    eventAnalyzeCompleted: function() {
        return eventAnalyzeCompleted;
    },
    eventBuildCompleted: function() {
        return eventBuildCompleted;
    },
    eventBuildFailed: function() {
        return eventBuildFailed;
    },
    eventBuildFeatureUsage: function() {
        return eventBuildFeatureUsage;
    },
    eventBuildOptimize: function() {
        return eventBuildOptimize;
    },
    eventErrorThrown: function() {
        return eventErrorThrown;
    },
    eventLintCheckCompleted: function() {
        return eventLintCheckCompleted;
    },
    eventMcpToolUsage: function() {
        return eventMcpToolUsage;
    },
    eventPackageUsedInGetServerSideProps: function() {
        return eventPackageUsedInGetServerSideProps;
    },
    eventTypeCheckCompleted: function() {
        return eventTypeCheckCompleted;
    }
});
const _errortelemetryutils = require("../../lib/error-telemetry-utils");
const REGEXP_DIRECTORY_DUNDER = /[\\/]__[^\\/]+(?<![\\/]__(?:tests|mocks))__[\\/]/i;
const REGEXP_DIRECTORY_TESTS = /[\\/]__(tests|mocks)__[\\/]/i;
const REGEXP_FILE_TEST = /\.(?:spec|test)\.[^.]+$/i;
const EVENT_TYPE_CHECK_COMPLETED = 'NEXT_TYPE_CHECK_COMPLETED';
function eventTypeCheckCompleted(event) {
    return {
        eventName: EVENT_TYPE_CHECK_COMPLETED,
        payload: event
    };
}
const EVENT_LINT_CHECK_COMPLETED = 'NEXT_LINT_CHECK_COMPLETED';
function eventLintCheckCompleted(event) {
    return {
        eventName: EVENT_LINT_CHECK_COMPLETED,
        payload: event
    };
}
const EVENT_ANALYZE_COMPLETED = 'NEXT_ANALYZE_COMPLETED';
function eventAnalyzeCompleted(event) {
    return {
        eventName: EVENT_ANALYZE_COMPLETED,
        payload: event
    };
}
const EVENT_BUILD_COMPLETED = 'NEXT_BUILD_COMPLETED';
function eventBuildCompleted(pagePaths, event) {
    return {
        eventName: EVENT_BUILD_COMPLETED,
        payload: {
            ...event,
            totalPageCount: pagePaths.length,
            hasDunderPages: pagePaths.some((path)=>REGEXP_DIRECTORY_DUNDER.test(path)),
            hasTestPages: pagePaths.some((path)=>REGEXP_DIRECTORY_TESTS.test(path) || REGEXP_FILE_TEST.test(path)),
            totalAppPagesCount: event.totalAppPagesCount
        }
    };
}
const EVENT_BUILD_FAILED = 'NEXT_BUILD_FAILED';
function eventBuildFailed(event) {
    return {
        eventName: EVENT_BUILD_FAILED,
        payload: event
    };
}
const EVENT_BUILD_OPTIMIZED = 'NEXT_BUILD_OPTIMIZED';
function eventBuildOptimize(pagePaths, event) {
    return {
        eventName: EVENT_BUILD_OPTIMIZED,
        payload: {
            ...event,
            totalPageCount: pagePaths.length,
            hasDunderPages: pagePaths.some((path)=>REGEXP_DIRECTORY_DUNDER.test(path)),
            hasTestPages: pagePaths.some((path)=>REGEXP_DIRECTORY_TESTS.test(path) || REGEXP_FILE_TEST.test(path)),
            totalAppPagesCount: event.totalAppPagesCount,
            staticAppPagesCount: event.staticAppPagesCount,
            serverAppPagesCount: event.serverAppPagesCount,
            edgeRuntimeAppCount: event.edgeRuntimeAppCount,
            edgeRuntimePagesCount: event.edgeRuntimePagesCount,
            isRspack: process.env.NEXT_RSPACK !== undefined
        }
    };
}
const EVENT_BUILD_FEATURE_USAGE = 'NEXT_BUILD_FEATURE_USAGE';
function eventBuildFeatureUsage(usages) {
    return usages.map(({ featureName, invocationCount })=>({
            eventName: EVENT_BUILD_FEATURE_USAGE,
            payload: {
                featureName,
                invocationCount
            }
        }));
}
const EVENT_NAME_PACKAGE_USED_IN_GET_SERVER_SIDE_PROPS = 'NEXT_PACKAGE_USED_IN_GET_SERVER_SIDE_PROPS';
function eventPackageUsedInGetServerSideProps(packagesUsedInServerSideProps) {
    return packagesUsedInServerSideProps.map((packageName)=>({
            eventName: EVENT_NAME_PACKAGE_USED_IN_GET_SERVER_SIDE_PROPS,
            payload: {
                package: packageName
            }
        }));
}
const EVENT_MCP_TOOL_USAGE = 'NEXT_MCP_TOOL_USAGE';
function eventMcpToolUsage(usages) {
    return usages.map(({ featureName, invocationCount })=>({
            eventName: EVENT_MCP_TOOL_USAGE,
            payload: {
                toolName: featureName,
                invocationCount
            }
        }));
}
const ERROR_THROWN_EVENT = 'NEXT_ERROR_THROWN';
function eventErrorThrown(error, anonymizedLocation) {
    return {
        eventName: ERROR_THROWN_EVENT,
        payload: {
            errorCode: (0, _errortelemetryutils.extractNextErrorCode)(error) || 'Unknown',
            location: anonymizedLocation
        }
    };
}

//# sourceMappingURL=build.js.map