"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "default", {
    enumerable: true,
    get: function() {
        return NextPageDisallowReExportAllExports;
    }
});
function NextPageDisallowReExportAllExports() {
    return {
        visitor: {
            ExportAllDeclaration (path) {
                var _path_node_loc, _path_node_loc1;
                const err = Object.defineProperty(new SyntaxError(`Using \`export * from '...'\` in a page is disallowed. Please use \`export { default } from '...'\` instead.\n` + `Read more: https://nextjs.org/docs/messages/export-all-in-page`), "__NEXT_ERROR_CODE", {
                    value: "E555",
                    enumerable: false,
                    configurable: true
                });
                err.code = 'BABEL_PARSE_ERROR';
                err.loc = ((_path_node_loc = path.node.loc) == null ? void 0 : _path_node_loc.start) ?? ((_path_node_loc1 = path.node.loc) == null ? void 0 : _path_node_loc1.end) ?? path.node.loc;
                throw err;
            }
        }
    };
}

//# sourceMappingURL=next-page-disallow-re-export-all-exports.js.map