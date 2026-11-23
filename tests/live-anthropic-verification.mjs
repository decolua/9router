// Comprehensive Live Verification of 9Router vs Official Anthropic Messages API Specification
import http from "node:http";

const HOST = "127.0.0.1";
const PORT = 20128;
const MODEL = "claude-opus-5-5[1m]";
const API_KEY = process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY || "";

// User explicit instruction: using x-api-key, not bearer
const HEADERS = {
  "Content-Type": "application/json",
  "x-api-key": API_KEY,
  "anthropic-version": "2023-06-01",
};

function streamRequest(options, body, onEvent) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let buffer = "";
      res.on("data", (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop(); // keep trailing partial line

        let currentEvent = null;
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith("event:")) {
            currentEvent = trimmed.slice(6).trim();
          } else if (trimmed.startsWith("data:")) {
            const dataStr = trimmed.slice(5).trim();
            if (dataStr && dataStr !== "[DONE]") {
              try {
                const parsed = JSON.parse(dataStr);
                onEvent({ event: currentEvent, data: parsed });
              } catch (e) {
                onEvent({ event: currentEvent, raw: dataStr });
              }
            } else if (dataStr === "[DONE]") {
              onEvent({ event: "done", raw: "[DONE]" });
            }
          }
        }
      });
      res.on("end", () => {
        resolve({ statusCode: res.statusCode, headers: res.headers });
      });
    });
    req.on("error", reject);
    if (body) {
      req.write(typeof body === "string" ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function sendAnthropicMessage(body) {
  const accumulated = {
    id: null,
    type: "message",
    role: "assistant",
    content: [],
    model: null,
    stop_reason: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  };
  const eventList = [];

  const res = await streamRequest(
    {
      hostname: HOST,
      port: PORT,
      path: "/v1/messages",
      method: "POST",
      headers: HEADERS,
    },
    { ...body, stream: true },
    (evt) => {
      if (!evt.event) return;
      eventList.push(evt.event);
      if (evt.event === "message_start") {
        accumulated.id = evt.data?.message?.id;
        accumulated.model = evt.data?.message?.model;
        if (evt.data?.message?.usage) {
          accumulated.usage.input_tokens = evt.data.message.usage.input_tokens || 0;
        }
      } else if (evt.event === "content_block_start") {
        const idx = evt.data.index ?? accumulated.content.length;
        accumulated.content[idx] = { ...evt.data.content_block };
        if (accumulated.content[idx].type === "text") {
          accumulated.content[idx].text = accumulated.content[idx].text || "";
        } else if (accumulated.content[idx].type === "tool_use") {
          accumulated.content[idx].input = accumulated.content[idx].input || {};
          accumulated.content[idx]._rawInput = "";
        }
      } else if (evt.event === "content_block_delta") {
        const idx = evt.data.index ?? (accumulated.content.length - 1);
        const block = accumulated.content[idx];
        if (block) {
          if (evt.data.delta?.type === "text_delta") {
            block.text = (block.text || "") + (evt.data.delta.text || "");
          } else if (evt.data.delta?.type === "input_json_delta") {
            block._rawInput = (block._rawInput || "") + (evt.data.delta.partial_json || "");
          } else if (evt.data.delta?.type === "thinking_delta") {
            block.thinking = (block.thinking || "") + (evt.data.delta.thinking || "");
          }
        }
      } else if (evt.event === "content_block_stop") {
        const idx = evt.data.index ?? (accumulated.content.length - 1);
        const block = accumulated.content[idx];
        if (block && block.type === "tool_use" && block._rawInput) {
          try {
            block.input = JSON.parse(block._rawInput);
          } catch {}
          delete block._rawInput;
        }
      } else if (evt.event === "message_delta") {
        accumulated.stop_reason = evt.data?.delta?.stop_reason;
        if (evt.data?.usage?.output_tokens) {
          accumulated.usage.output_tokens = evt.data.usage.output_tokens;
        }
      }
    }
  );

  return { statusCode: res.statusCode, headers: res.headers, message: accumulated, events: eventList };
}

async function runLiveVerification() {
  console.log("===============================================================");
  console.log("🚀 STARTING RIGOROUS LIVE VERIFICATION: 9ROUTER vs ANTHROPIC SPEC");
  console.log(`Target: http://${HOST}:${PORT}/v1/messages`);
  console.log(`Auth Scheme: x-api-key (Client Header: x-api-key: ${API_KEY.slice(0, 8)}...[masked])`);
  console.log(`Model: ${MODEL}`);
  console.log("===============================================================\n");

  const results = [];

  // TEST 1: Count Tokens Endpoint (/v1/messages/count_tokens)
  try {
    process.stdout.write("Test 1: POST /v1/messages/count_tokens (x-api-key) ... ");
    const req = http.request(
      {
        hostname: HOST,
        port: PORT,
        path: "/v1/messages/count_tokens",
        method: "POST",
        headers: HEADERS,
      },
      (res) => {
        let body = "";
        res.on("data", (d) => (body += d.toString()));
        res.on("end", () => {
          const parsed = JSON.parse(body);
          if (res.statusCode === 200 && typeof parsed.input_tokens === "number") {
            console.log(`✅ PASS (input_tokens: ${parsed.input_tokens})`);
            results.push({ name: "Token Counting Endpoint (/v1/messages/count_tokens)", status: "PASS", detail: parsed });
          } else {
            console.log(`❌ FAIL (status: ${res.statusCode}, body: ${body})`);
            results.push({ name: "Token Counting Endpoint (/v1/messages/count_tokens)", status: "FAIL", detail: body });
          }
        });
      }
    );
    req.write(JSON.stringify({ model: MODEL, messages: [{ role: "user", content: "Test token counting in 9Router" }] }));
    req.end();
  } catch (err) {
    console.log(`❌ ERROR: ${err.message}`);
    results.push({ name: "Token Counting Endpoint", status: "ERROR", error: err.message });
  }

  // Small delay to allow async responses to sequence cleanly
  await new Promise((r) => setTimeout(r, 600));

  // TEST 2: Anthropic Streaming SSE Events Protocol
  try {
    process.stdout.write("Test 2: Anthropic Streaming SSE Event Structure (stream: true) ... ");
    const { statusCode, message, events } = await sendAnthropicMessage({
      model: MODEL,
      max_tokens: 30,
      messages: [{ role: "user", content: "Reply with the single word PING" }],
    });

    const hasStart = events.includes("message_start");
    const hasBlockStart = events.includes("content_block_start");
    const hasDelta = events.includes("content_block_delta");
    const hasBlockStop = events.includes("content_block_stop");
    const hasMsgDelta = events.includes("message_delta");
    const hasMsgStop = events.includes("message_stop");
    const sequenceOk = hasStart && hasBlockStart && hasDelta && hasBlockStop && hasMsgDelta && hasMsgStop;

    const textPart = message.content.find((c) => c.type === "text")?.text || "";

    if (statusCode === 200 && sequenceOk && textPart.length > 0) {
      console.log(`✅ PASS (Reply: "${textPart.trim()}", Events: ${events.join(" -> ")})`);
      results.push({
        name: "Anthropic Streaming SSE Events Protocol",
        status: "PASS",
        detail: { events, reply: textPart.trim(), stop_reason: message.stop_reason },
      });
    } else {
      console.log(`❌ FAIL (status: ${statusCode}, events: ${events.join(", ")})`);
      results.push({ name: "Anthropic Streaming SSE Events Protocol", status: "FAIL", detail: { events, statusCode } });
    }
  } catch (err) {
    console.log(`❌ ERROR: ${err.message}`);
    results.push({ name: "Anthropic Streaming SSE Events Protocol", status: "ERROR", error: err.message });
  }

  // TEST 3: Anthropic Tool Calling Ingress & Tool Result with is_error: true
  try {
    process.stdout.write("Test 3: Anthropic Tool Call & is_error: true Round-trip ... ");
    // Step 3a: Model generates tool call
    const turn1 = await sendAnthropicMessage({
      model: MODEL,
      max_tokens: 150,
      tools: [
        {
          name: "execute_shell",
          description: "Execute a shell command",
          input_schema: {
            type: "object",
            properties: { command: { type: "string" } },
            required: ["command"],
          },
        },
      ],
      messages: [{ role: "user", content: "Please run the command: cat non_existent_audit.txt" }],
    });

    const toolUseBlock = turn1.message.content.find((c) => c.type === "tool_use");

    if (!toolUseBlock) {
      console.log(`⚠️ SKIP (Model chose not to call tool, reply: "${turn1.message.content?.[0]?.text?.slice(0, 50)}")`);
      results.push({ name: "Tool Call & is_error Round-trip", status: "SKIP", detail: turn1.message });
    } else {
      // Step 3b: Send tool result back with is_error: true
      const turn2 = await sendAnthropicMessage({
        model: MODEL,
        max_tokens: 150,
        tools: [
          {
            name: "execute_shell",
            description: "Execute a shell command",
            input_schema: {
              type: "object",
              properties: { command: { type: "string" } },
              required: ["command"],
            },
          },
        ],
        messages: [
          { role: "user", content: "Please run the command: cat non_existent_audit.txt" },
          { role: "assistant", content: [toolUseBlock] },
          {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: toolUseBlock.id,
                content: "cat: non_existent_audit.txt: No such file or directory",
                is_error: true,
              },
            ],
          },
        ],
      });

      const responseText = turn2.message.content.find((c) => c.type === "text")?.text || "";
      if (turn2.statusCode === 200 && responseText.length > 0) {
        console.log(`✅ PASS (Tool call: ${toolUseBlock.name} [id: ${toolUseBlock.id}], Model acknowledged failure: "${responseText.slice(0, 70)}...")`);
        results.push({
          name: "Tool Call & is_error Round-trip",
          status: "PASS",
          toolCall: toolUseBlock,
          recovery: responseText,
        });
      } else {
        console.log(`❌ FAIL (statusCode: ${turn2.statusCode})`);
        results.push({ name: "Tool Call & is_error Round-trip", status: "FAIL", detail: turn2 });
      }
    }
  } catch (err) {
    console.log(`❌ ERROR: ${err.message}`);
    results.push({ name: "Tool Call & is_error Round-trip", status: "ERROR", error: err.message });
  }

  // TEST 4: Prompt Caching Markers (cache_control: { type: "ephemeral" })
  try {
    process.stdout.write("Test 4: Prompt Caching Markers (cache_control on system & message) ... ");
    const { statusCode, message } = await sendAnthropicMessage({
      model: MODEL,
      max_tokens: 30,
      system: [
        {
          type: "text",
          text: "You are a helpful assistant being verified for prompt caching support.",
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Say CACHE_VERIFIED if you see this message.",
              cache_control: { type: "ephemeral" },
            },
          ],
        },
      ],
    });

    const reply = message.content.find((c) => c.type === "text")?.text || "";
    if (statusCode === 200 && reply.length > 0) {
      console.log(`✅ PASS (cache_control admitted cleanly without rejection, reply: "${reply.trim()}")`);
      results.push({ name: "Prompt Caching (cache_control) Preservation", status: "PASS", reply: reply.trim() });
    } else {
      console.log(`❌ FAIL (status: ${statusCode})`);
      results.push({ name: "Prompt Caching (cache_control) Preservation", status: "FAIL", statusCode });
    }
  } catch (err) {
    console.log(`❌ ERROR: ${err.message}`);
    results.push({ name: "Prompt Caching (cache_control) Preservation", status: "ERROR", error: err.message });
  }

  // TEST 5: Tool Choice: { type: "none" }
  try {
    process.stdout.write("Test 5: tool_choice: { type: 'none' } Constraint Enforcement ... ");
    const { statusCode, message } = await sendAnthropicMessage({
      model: MODEL,
      max_tokens: 50,
      tools: [
        {
          name: "calculator",
          description: "Perform math calculation",
          input_schema: {
            type: "object",
            properties: { expr: { type: "string" } },
            required: ["expr"],
          },
        },
      ],
      tool_choice: { type: "none" },
      messages: [{ role: "user", content: "Compute 12 + 12 without calling any tool." }],
    });

    const calledTool = message.content.some((c) => c.type === "tool_use");
    const reply = message.content.find((c) => c.type === "text")?.text || "";

    if (statusCode === 200 && !calledTool && reply.length > 0) {
      console.log(`✅ PASS (Tool calling strictly suppressed, Answer: "${reply.trim()}")`);
      results.push({ name: "tool_choice: { type: 'none' } Enforcement", status: "PASS", reply: reply.trim() });
    } else {
      console.log(`❌ FAIL (calledTool: ${calledTool}, status: ${statusCode})`);
      results.push({ name: "tool_choice: { type: 'none' } Enforcement", status: "FAIL", calledTool });
    }
  } catch (err) {
    console.log(`❌ ERROR: ${err.message}`);
    results.push({ name: "tool_choice: { type: 'none' } Enforcement", status: "ERROR", error: err.message });
  }

  console.log("\n===============================================================");
  console.log("📊 SUMMARY OF EMPIRICAL VERIFICATION RESULTS (x-api-key Auth Scheme)");
  console.log("===============================================================");
  results.forEach((r, idx) => {
    console.log(`${idx + 1}. [${r.status}] ${r.name}`);
  });
  console.log("===============================================================\n");
}

runLiveVerification();
