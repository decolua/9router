"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "registerGetActionByIdTool", {
    enumerable: true,
    get: function() {
        return registerGetActionByIdTool;
    }
});
const _zod = require("next/dist/compiled/zod");
const _fs = require("fs");
const _path = require("path");
const _mcptelemetrytracker = require("../mcp-telemetry-tracker");
const INLINE_ACTION_PREFIX = '$$RSC_SERVER_ACTION_';
function registerGetActionByIdTool(server, distDir) {
    server.registerTool('get_server_action_by_id', {
        description: 'Locates a Server Action by its ID in the server-reference-manifest.json. Returns the filename and export name for the action.',
        inputSchema: {
            actionId: _zod.z.string()
        }
    }, async (request)=>{
        // Track telemetry
        _mcptelemetrytracker.mcpTelemetryTracker.recordToolCall('mcp/get_server_action_by_id');
        try {
            const { actionId } = request;
            if (!actionId) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                error: 'actionId parameter is required'
                            })
                        }
                    ]
                };
            }
            const manifestPath = (0, _path.join)(distDir, 'server', 'server-reference-manifest.json');
            let manifestContent;
            try {
                manifestContent = await _fs.promises.readFile(manifestPath, 'utf-8');
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                error: `Could not read server-reference-manifest.json at ${manifestPath}.`
                            })
                        }
                    ]
                };
            }
            const manifest = JSON.parse(manifestContent);
            // Search in node entries
            if (manifest.node && manifest.node[actionId]) {
                const entry = manifest.node[actionId];
                const isInlineAction = entry.exportedName.startsWith(INLINE_ACTION_PREFIX);
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                actionId,
                                runtime: 'node',
                                filename: entry.filename,
                                functionName: isInlineAction ? 'inline server action' : entry.exportedName,
                                layer: entry.layer,
                                workers: entry.workers
                            }, null, 2)
                        }
                    ]
                };
            }
            // Search in edge entries
            if (manifest.edge && manifest.edge[actionId]) {
                const entry = manifest.edge[actionId];
                const isInlineAction = entry.exportedName.startsWith(INLINE_ACTION_PREFIX);
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                actionId,
                                runtime: 'edge',
                                filename: entry.filename,
                                functionName: isInlineAction ? 'inline server action' : entry.exportedName,
                                layer: entry.layer,
                                workers: entry.workers
                            }, null, 2)
                        }
                    ]
                };
            }
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            error: `Action ID "${actionId}" not found in server-reference-manifest.json`
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

//# sourceMappingURL=get-server-action-by-id.js.map