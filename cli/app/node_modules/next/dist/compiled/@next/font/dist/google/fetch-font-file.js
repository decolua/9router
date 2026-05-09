"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchFontFile = fetchFontFile;
const node_fs_1 = __importDefault(require("node:fs"));
const retry_1 = require("./retry");
const fetch_resource_1 = require("./fetch-resource");
/**
 * Fetches a font file and returns its contents as a Buffer.
 * If NEXT_FONT_GOOGLE_MOCKED_RESPONSES is set, we handle mock data logic.
 */
async function fetchFontFile(url, isDev) {
    if (process.env.NEXT_FONT_GOOGLE_MOCKED_RESPONSES) {
        if (url.startsWith('/')) {
            return node_fs_1.default.readFileSync(url);
        }
        return Buffer.from(url);
    }
    return await (0, retry_1.retry)(async () => {
        return (0, fetch_resource_1.fetchResource)(url, isDev, `Failed to fetch font file from \`${url}\`.`);
    }, 3);
}
