/**
 * MCP tool for getting the path to the Next.js development log file.
 *
 * This tool returns the path to the {nextConfig.distDir}/logs/next-development.log file
 * that contains browser console logs and other development information.
 */ "use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "registerGetLogsTool", {
    enumerable: true,
    get: function() {
        return registerGetLogsTool;
    }
});
const _promises = require("fs/promises");
const _path = require("path");
const _mcptelemetrytracker = require("../mcp-telemetry-tracker");
function registerGetLogsTool(server, distDir) {
    server.registerTool('get_logs', {
        description: 'Get the path to the Next.js development log file. Returns the file path so the agent can read the logs directly.'
    }, async ()=>{
        // Track telemetry
        _mcptelemetrytracker.mcpTelemetryTracker.recordToolCall('mcp/get_logs');
        try {
            const logFilePath = (0, _path.join)(distDir, 'logs', 'next-development.log');
            // Check if the log file exists
            try {
                await (0, _promises.stat)(logFilePath);
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                error: `Log file not found at ${logFilePath}.`
                            })
                        }
                    ]
                };
            }
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            logFilePath
                        })
                    }
                ]
            };
        } catch (error) {
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            error: `Error getting log file path: ${error instanceof Error ? error.message : String(error)}`
                        })
                    }
                ]
            };
        }
    });
}

//# sourceMappingURL=get-logs.js.map