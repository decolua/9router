// Live test: combo capacity display + auto-switch routing.
// Sends text / image / search requests to a combo and reports which member ran.
//   node scripts/test-combo-autoswitch.mjs
const BASE = process.env.BASE_URL || "http://localhost:20127";
const KEY = process.env.API_KEY || "sk-6581be4f05a82b6b-uxy6jn-c8190ea8";
const COMBO = process.env.COMBO || "haha";

// 16x16 PNG (valid image so vision providers accept it).
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGO4I2JDEmIY1TCqYfhqAAAeBCwQ8YdREQAAAABJRU5ErkJggg==";

function memberFromModel(model) {
  // Response model usually = upstream id; map back to a combo member by substring.
  return model || "(none)";
}

async function send(label, content, extra = {}) {
  const body = {
    model: COMBO,
    stream: false,
    max_tokens: 64,
    messages: [{ role: "user", content }],
    ...extra,
  };
  const t0 = Date.now();
  let res, json, text;
  try {
    res = await fetch(`${BASE}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
      body: JSON.stringify(body),
    });
    text = await res.text();
    try { json = JSON.parse(text); } catch { /* keep text */ }
  } catch (e) {
    console.log(`\n[${label}] NETWORK ERROR: ${e.message}`);
    return;
  }
  const ms = Date.now() - t0;
  const model = json?.model || "(no model field)";
  const ok = res.ok;
  const snippet = (json?.choices?.[0]?.message?.content || text || "").slice(0, 80).replace(/\n/g, " ");
  console.log(`\n[${label}] ${ok ? "OK" : "FAIL"} ${res.status} (${ms}ms)`);
  console.log(`  model executed: ${memberFromModel(model)}`);
  if (!ok) console.log(`  error: ${(json?.error?.message || text || "").slice(0, 160)}`);
  else console.log(`  reply: ${snippet}`);
}

async function showCaps() {
  try {
    const r = await fetch(`${BASE}/api/models`, { headers: { Authorization: `Bearer ${KEY}` } });
    if (!r.ok) { console.log("(/api/models needs dashboard auth, skipping caps table)"); return; }
    const { models } = await r.json();
    const map = {};
    for (const m of models || []) if (m.caps) map[m.fullModel] = m.caps;
    console.log("Capacity of combo members (vision/search):");
    for (const m of (process.env.MEMBERS || "").split(",").filter(Boolean)) {
      const c = map[m] || {};
      console.log(`  ${m}: vision=${!!c.vision} search=${!!c.search}`);
    }
  } catch { /* ignore */ }
}

(async () => {
  console.log(`Testing combo "${COMBO}" @ ${BASE}\n${"=".repeat(50)}`);
  await showCaps();

  // 1. Text-only: round-robin order (no capability requirement).
  await send("text-only #1", "Say hello in one word.");
  await send("text-only #2", "Say hi in one word.");

  // 2. Image: should auto-switch to a vision-capable member.
  await send("image (needs vision)", [
    { type: "text", text: "What color is this image? One word." },
    { type: "image_url", image_url: { url: PNG } },
  ]);

  // 3. Search: should auto-switch to a search-capable member.
  // Claude built-in web search requires a versioned tool type.
  await send("search (needs search)", "What is the latest news today?", {
    tools: [{ type: "web_search_20250305", name: "web_search" }],
  });

  console.log(`\n${"=".repeat(50)}\nDone. Compare 'model executed' across cases to verify auto-switch.`);
})();
