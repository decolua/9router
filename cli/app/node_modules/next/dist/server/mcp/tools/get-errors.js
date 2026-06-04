/**
 * MCP tool for retrieving error state from Next.js dev server.
 *
 * This tool provides comprehensive error reporting including:
 * - Next.js global errors (e.g., next.config validation errors)
 * - Browser runtime errors with source-mapped stack traces
 * - Build errors from webpack/turbopack compilation
 *
 * For browser errors, it leverages the HMR infrastructure for server-to-browser communication.
 *
 * Flow:
 *   MCP client → server generates request ID → HMR message to browser →
 *   browser queries error overlay state → HMR response back → server performs source mapping →
 *   combined with global errors → formatted output.
 */ "use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    handleErrorStateResponse: null,
    registerGetErrorsTool: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    handleErrorStateResponse: function() {
        return handleErrorStateResponse;
    },
    registerGetErrorsTool: function() {
        return registerGetErrorsTool;
    }
});
const _hotreloadertypes = require("../../dev/hot-reloader-types");
const _formaterrors = require("./utils/format-errors");
const _browsercommunication = require("./utils/browser-communication");
const _nextinstanceerrorstate = require("./next-instance-error-state");
const _mcptelemetrytracker = require("../mcp-telemetry-tracker");
function registerGetErrorsTool(server, sendHmrMessage, getActiveConnectionCount) {
    server.registerTool('get_errors', {
        description: 'Get the current error state from the Next.js dev server, including Next.js global errors (e.g., next.config validation), browser runtime errors, and build errors with source-mapped stack traces',
        inputSchema: {}
    }, async (_request)=>{
        // Track telemetry
        _mcptelemetrytracker.mcpTelemetryTracker.recordToolCall('mcp/get_errors');
        try {
            const connectionCount = getActiveConnectionCount();
            if (connectionCount === 0) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                error: 'No browser sessions connected. Please open your application in a browser to retrieve error state.'
                            })
                        }
                    ]
                };
            }
            const responses = await (0, _browsercommunication.createBrowserRequest)(_hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.REQUEST_CURRENT_ERROR_STATE, sendHmrMessage, getActiveConnectionCount, _browsercommunication.DEFAULT_BROWSER_REQUEST_TIMEOUT_MS);
            // The error state for each route
            // key is the route path, value is the error state
            const routesErrorState = new Map();
            for (const response of responses){
                if (response.data) {
                    routesErrorState.set(response.url, response.data);
                }
            }
            const hasRouteErrors = Array.from(routesErrorState.values()).some((state)=>state.errors.length > 0 || !!state.buildError);
            const hasInstanceErrors = _nextinstanceerrorstate.NextInstanceErrorState.nextConfig.length > 0;
            if (!hasRouteErrors && !hasInstanceErrors) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                configErrors: [],
                                sessionErrors: []
                            })
                        }
                    ]
                };
            }
            const output = await (0, _formaterrors.formatErrors)(routesErrorState, _nextinstanceerrorstate.NextInstanceErrorState);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify(output)
                    }
                ]
            };
        } catch (error) {
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            error: error instanceof Error ? error.message : String(error)
                        })
                    }
                ]
            };
        }
    });
}
function handleErrorStateResponse(requestId, errorState, url) {
    (0, _browsercommunication.handleBrowserPageResponse)(requestId, errorState, url || '');
}

//# sourceMappingURL=get-errors.js.map