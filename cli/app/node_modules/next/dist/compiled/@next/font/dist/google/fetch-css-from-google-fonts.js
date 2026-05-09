"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchCSSFromGoogleFonts = fetchCSSFromGoogleFonts;
const next_font_error_1 = require("../next-font-error");
const fetch_resource_1 = require("./fetch-resource");
const retry_1 = require("./retry");
/**
 * Fetches the CSS containing the @font-face declarations from Google Fonts.
 * The fetch has a user agent header with a modern browser to ensure we'll get .woff2 files.
 *
 * The env variable NEXT_FONT_GOOGLE_MOCKED_RESPONSES may be set containing a path to mocked data.
 * It's used to define mocked data to avoid hitting the Google Fonts API during tests.
 */
async function fetchCSSFromGoogleFonts(url, fontFamily, isDev) {
    if (process.env.NEXT_FONT_GOOGLE_MOCKED_RESPONSES) {
        const mockFile = require(process.env.NEXT_FONT_GOOGLE_MOCKED_RESPONSES);
        const mockedResponse = mockFile[url];
        if (!mockedResponse) {
            (0, next_font_error_1.nextFontError)('Missing mocked response for URL: ' + url);
        }
        return mockedResponse;
    }
    const buffer = await (0, retry_1.retry)(async () => {
        return (0, fetch_resource_1.fetchResource)(url, isDev, `Failed to fetch font \`${fontFamily}\`: ${url}\n` +
            `Please check your network connection.`);
    }, 3);
    return buffer.toString('utf8');
}
