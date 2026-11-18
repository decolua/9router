import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const dispatch = require("../../realtime/realtime-websocket.js");
const handlers = {
  openAI: () => "openai",
  codex: () => "codex",
};
let response;
const socket = { end: (value) => { response = value; } };
const route = (url) => dispatch(null, { url }, socket, null, handlers);
assert.equal(route("/v1/realtime?model=gpt-realtime"), "openai");
assert.equal(route("/v1/realtime?model=openai%2Fgpt-realtime"), "openai");
assert.equal(route("/v1/realtime?model=cx%2Fgpt-live-1-codex"), "codex");
assert.equal(route("/v1/codex-voice/ws?model=cx%2Fgpt-live-1-codex"), "codex");
assert.equal(route("/other"), false);
for (const query of ["model=unknown", "model=evil%2Fgpt-realtime", "model=gpt-realtime&model=cx%2Fgpt-live-1-codex", "model=openai%2Fhttps%3A%2F%2Fevil.test"]) {
  assert.equal(route(`/v1/realtime?${query}`), true);
  assert.match(response, /^HTTP\/1\.1 400 /);
}
console.log("realtime dispatch checks passed");