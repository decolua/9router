import assert from "node:assert/strict";
import "../../tests/translator/registerAll.js";
import { translateRequest } from "../translator/index.js";
import { FORMATS } from "../translator/formats.js";

// 1. functionResponse + functionCall in same content
{
  const body = {
    contents: [
      { role: "user", parts: [{ text: "do two things" }] },
      { role: "model", parts: [
        { functionCall: { id: "call_a", name: "search", args: { q: "x" } } },
      ] },
      { role: "user", parts: [
        { functionResponse: { id: "call_a", name: "search", response: { result: "found x" } } },
        { functionCall: { id: "call_b", name: "edit", args: { pattern: "y" } } },
      ] },
    ],
  };
  const out = translateRequest(FORMATS.GEMINI, FORMATS.OPENAI, "m", body, true);
  const json = JSON.stringify(out);
  assert.ok(json.includes("edit"), "functionCall 'edit' preserved alongside functionResponse");
  assert.ok(json.includes("search"), "functionResponse 'search' preserved");
  assert.ok(json.includes("found x"), "functionResponse content preserved");
}

// 2. functionResponse alone
{
  const body = {
    contents: [
      { role: "user", parts: [{ text: "q" }] },
      { role: "model", parts: [
        { functionCall: { id: "call_1", name: "search", args: { q: "x" } } },
      ] },
      { role: "user", parts: [
        { functionResponse: { id: "call_1", name: "search", response: { result: "r1" } } },
      ] },
    ],
  };
  const out = translateRequest(FORMATS.GEMINI, FORMATS.OPENAI, "m", body, true);
  const toolMsg = out.messages.find(m => m.role === "tool");
  assert.ok(toolMsg, "tool message present");
  assert.equal(toolMsg.tool_call_id, "call_1");
  assert.equal(toolMsg.content, '"r1"');
}

// 3. Multiple functionResponses
{
  const body = {
    contents: [
      { role: "user", parts: [{ text: "q" }] },
      { role: "model", parts: [
        { functionCall: { id: "c1", name: "f1", args: {} } },
        { functionCall: { id: "c2", name: "f2", args: {} } },
      ] },
      { role: "user", parts: [
        { functionResponse: { id: "c1", name: "f1", response: { result: "r1" } } },
        { functionResponse: { id: "c2", name: "f2", response: { result: "r2" } } },
      ] },
    ],
  };
  const out = translateRequest(FORMATS.GEMINI, FORMATS.OPENAI, "m", body, true);
  const toolMsgs = out.messages.filter(m => m.role === "tool");
  assert.equal(toolMsgs.length, 2, "both tool results preserved");
  assert.ok(toolMsgs.some(m => m.tool_call_id === "c1"), "first tool result present");
  assert.ok(toolMsgs.some(m => m.tool_call_id === "c2"), "second tool result present");
  assert.ok(
    out.messages.every(m => m && typeof m === "object" && !Array.isArray(m) && typeof m.role === "string"),
    "parent loop must spread array results; push(converted) nests them"
  );
}

// 4. functionResponse + text
{
  const body = {
    contents: [
      { role: "user", parts: [{ text: "q" }] },
      { role: "model", parts: [
        { functionCall: { id: "c1", name: "f1", args: {} } },
      ] },
      { role: "user", parts: [
        { functionResponse: { id: "c1", name: "f1", response: { result: "r1" } } },
        { text: "and here is some text" },
      ] },
    ],
  };
  const out = translateRequest(FORMATS.GEMINI, FORMATS.OPENAI, "m", body, true);
  const toolMsg = out.messages.find(m => m.role === "tool");
  const userMsg = out.messages.find(m => m.role === "user" && m.content === "and here is some text");
  assert.ok(toolMsg, "tool message present");
  assert.ok(userMsg, "user text preserved with correct role:user");
  const asstWithText = out.messages.find(m => m.role === "assistant" && m.content === "and here is some text");
  assert.ok(!asstWithText, "user text must NOT be attributed to assistant");
}

console.log("geminiFunctionResponseSelfCheck: 4/4");
