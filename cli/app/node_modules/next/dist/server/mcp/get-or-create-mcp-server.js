"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "getOrCreateMcpServer", {
    enumerable: true,
    get: function() {
        return getOrCreateMcpServer;
    }
});
const _mcp = require("next/dist/compiled/@modelcontextprotocol/sdk/server/mcp");
const _getprojectmetadata = require("./tools/get-project-metadata");
const _geterrors = require("./tools/get-errors");
const _getpagemetadata = require("./tools/get-page-metadata");
const _getlogs = require("./tools/get-logs");
const _getserveractionbyid = require("./tools/get-server-action-by-id");
const _getroutes = require("./tools/get-routes");
let mcpServer;
const getOrCreateMcpServer = (options)=>{
    if (mcpServer) {
        return mcpServer;
    }
    mcpServer = new _mcp.McpServer({
        name: 'Next.js MCP Server',
        version: '0.2.0'
    });
    (0, _getprojectmetadata.registerGetProjectMetadataTool)(mcpServer, options.projectPath, options.getDevServerUrl);
    (0, _geterrors.registerGetErrorsTool)(mcpServer, options.sendHmrMessage, options.getActiveConnectionCount);
    (0, _getpagemetadata.registerGetPageMetadataTool)(mcpServer, options.sendHmrMessage, options.getActiveConnectionCount);
    (0, _getlogs.registerGetLogsTool)(mcpServer, options.distDir);
    (0, _getserveractionbyid.registerGetActionByIdTool)(mcpServer, options.distDir);
    (0, _getroutes.registerGetRoutesTool)(mcpServer, {
        projectPath: options.projectPath,
        nextConfig: options.nextConfig,
        pagesDir: options.pagesDir,
        appDir: options.appDir
    });
    return mcpServer;
};

//# sourceMappingURL=get-or-create-mcp-server.js.map