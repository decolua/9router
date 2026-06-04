"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "registerGetProjectMetadataTool", {
    enumerable: true,
    get: function() {
        return registerGetProjectMetadataTool;
    }
});
const _mcptelemetrytracker = require("../mcp-telemetry-tracker");
function registerGetProjectMetadataTool(server, projectPath, getDevServerUrl) {
    server.registerTool('get_project_metadata', {
        description: 'Returns the the metadata of this Next.js project, including project path, dev server URL, etc.',
        inputSchema: {}
    }, async (_request)=>{
        // Track telemetry
        _mcptelemetrytracker.mcpTelemetryTracker.recordToolCall('mcp/get_project_metadata');
        try {
            if (!projectPath) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                error: 'Unable to determine the absolute path of the Next.js project.'
                            })
                        }
                    ]
                };
            }
            const devServerUrl = getDevServerUrl();
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            projectPath,
                            devServerUrl
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
                            error: error instanceof Error ? error.message : String(error)
                        })
                    }
                ]
            };
        }
    });
}

//# sourceMappingURL=get-project-metadata.js.map