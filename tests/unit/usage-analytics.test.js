import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseUsageRange } from "@/lib/usage/range.js";
import { fingerprint } from "@/lib/db/helpers/usageFingerprint.js";

const parse = q => parseUsageRange(new URLSearchParams(q), Date.parse("2026-11-24T12:00Z"));
const all = parse("period=all");
it.each(["1h","24h","7d","30d","90d","all","today","60d"])("accepts period %s", p => {
  expect(parse("period="+p)).toHaveProperty("bucketSeconds");
});
it.each(["period=year","period=","from=2024-01-01","to=2024-01-01","period=all&from=x&to=y",
  "from=2024-02-30&to=2025-01-01","from=2024-01-02&to=2024-01-02","from=2026-01-02&to=2025-01-02",
  "from=2024-02-29&to=2026-03-01","from=2024-01-01T12:00&to=2024-02-01","period=all&period=7d"])("rejects %s", q => expect(() => parse(q)).toThrow());
it("accepts exact two-year boundary and normalizes offsets", () => {
  expect(parse("from=2024-02-29&to=2026-02-28").from).toBe("2024-02-29T00:00:00.000Z");
  expect(parse("from=2025-12-31T21:00:00-03:00&to=2026-01-02").from).toBe("2026-01-01T00:00:00.000Z");
  expect(parse("period=1h").from).toBe("2026-11-24T11:00:00.000Z");
});

const dir = mkdtempSync(join(tmpdir(), "usage-report-"));
let db, repo, reports, createUsageReports, usageExport, rotateApiKey;
const at = "2026-11-24T08:00:00.000Z";
beforeAll(async () => {
  vi.stubEnv("DATA_DIR", dir);
  db = await (await import("@/lib/db/driver.js")).getAdapter();
  ({ createUsageReports } = await import("@/lib/db/repos/usageAnalyticsRepo.js"));
  reports = createUsageReports(db);
  ({ usageExport } = await import("@/lib/usage/export.js"));
  ({ rotateApiKey } = await import("@/lib/db/repos/apiKeysRepo.js"));
  repo = await import("@/lib/db/index.js");
});
beforeEach(() => db.run("DELETE FROM usageHistory"));
afterAll(() => { db?.close(); delete global._dbAdapter; vi.unstubAllEnvs(); rmSync(dir, { recursive: true, force: true }); });

it("aggregates measured samples, rotation, historical costs, hourly counts and errors", async () => {
  const key = await repo.createApiKey("Team", "fixture");
  const old = fingerprint(key.key), rotated = await rotateApiKey(key.id, 1);
  const current = fingerprint(rotated.key);
  const sql = `INSERT INTO usageHistory(timestamp,provider,model,connectionId,apiKey,status,promptTokens,completionTokens,cost,tokens,meta)
    VALUES(?,'acme','model','abcd1234-hidden',?,?,2,3,0.25,?,?)`;
  for (let i=1; i<=100; i++) db.run(sql,[at,i%2 ? old : current,i%10 ? "ok" : "error",
    '{"cached_tokens":1,"completion_tokens_details":{"reasoning_tokens":2}}',
    JSON.stringify({latencyMs:i, errorCategory:i%20 ? "timeout" : "network"})]);
  db.run(sql,[at,current,"ok","{}",'{"usageReported":false}']);
  db.run(sql,["2026-11-25T00:00:00.000Z",old,"ok","{}","{}"]);
  const result = reports.analytics(parse("from=2026-11-24&to=2026-11-25"));
  expect(result.totals).toEqual({ requests:101, success:91, failed:10, inputTokens:202, outputTokens:303,
    cachedTokens:100, reasoningTokens:200, estimatedCost:25.25, usageUnreported:1 });
  expect(result.latencyMs).toEqual({ avg:50.5, p50:50,p95:95,p99:99 });
  expect(result.breakdowns.apiKey).toEqual([{ id:key.id,name:"Team",project:null,requests:101,tokens:505,cost:25.25,errorRate:10/101 }]);
  expect(result.heatmap).toEqual([{day:2,hour:8,requests:101}]);
  expect(result.timeSeries[0]).toMatchObject({requests:101,failed:10,tokens:505,cost:25.25});
  expect(result.errorConnections).toEqual([{name:"acme · abcd1234",failed:10,categories:{timeout:5,network:5}}]);
  for (const secret of [key.key, rotated.key, old, current,"abcd1234-hidden"]) expect(JSON.stringify(result)).not.toContain(secret);
});

it("keeps absent measurements null and explicit zero measured", () => {
  db.run("INSERT INTO usageHistory(timestamp,meta) VALUES(?,'{}')",[at]);
  const blank = reports.analytics(all);
  expect(blank.latencyMs).toEqual({avg:null,p50:null,p95:null,p99:null});
  expect(blank.totals).toMatchObject({cachedTokens:null,reasoningTokens:null});
  db.run(`UPDATE usageHistory SET meta='{"latencyMs":0}',tokens='{"cached_tokens":0}'`);
  expect(reports.analytics(all)).toMatchObject({latencyMs:{avg:0,p99:0},totals:{cachedTokens:0}});
});

it("streams allowlisted JSON and RFC 4180 CSV; rejects oversize before headers", async () => {
  const key = await repo.createApiKey('Team, "blue"', "export");
  const email = "test@example.org", ref = fingerprint(key.key);
  const values = ["=cmd()", "+cmd", "-cmd", "@cmd", "\tcmd", "\rcmd"];
  for (const model of values) db.run(`INSERT INTO usageHistory(timestamp,apiKey,model,endpoint,connectionId,meta) VALUES(?,?,?,?,?,?)`,
    [at,ref,model,"https://"+email+"/v1/chat?key="+key.key,email,JSON.stringify({body:key.key,latencyMs:42,errorCategory:email})]);
  const resp = usageExport(reports,all,"csv",6), csv = await resp.text();
  expect(resp.headers.get("content-disposition")).toContain("attachment");
  expect(resp.headers.get("cache-control")).toBe("no-store");
  expect(csv).toContain('"Team, ""blue"""'); expect(csv).toContain("\r\n");
  for (const v of values) expect(csv).toContain("'"+v);
  const json = await usageExport(reports,all,"json").text();
  expect(JSON.parse(json)).toHaveLength(6);
  expect(JSON.parse(json)[0]).toMatchObject({model:"=cmd()",endpoint:"/v1/chat",latencyMs:42,connection:null,errorCategory:null});
  for (const s of [email,key.key,ref]) for (const bytes of [csv,json,JSON.stringify(reports.analytics(all))]) expect(bytes).not.toContain(s);
  expect(() => usageExport(reports,all,"csv",5)).toThrow(/exceeds 5/);
  expect(() => usageExport(reports,all,"xml")).toThrow();
  expect(await usageExport(reports,parse("from=2024-01-01&to=2024-01-02"),"json").json()).toEqual([]);
});

it("freezes costs and records tariff used at write time", async () => {
  const entry = {provider:"openai",model:"gpt-4",tokens:{prompt_tokens:10000,completion_tokens:1000}};
  await repo.saveRequestUsage({...entry,requestId:"before"});
  const first = db.get("SELECT cost,meta FROM usageHistory");
  await repo.updatePricing({openai:{"gpt-4":{input:1,output:5}}});
  await repo.saveRequestUsage({...entry,requestId:"after"});
  const rows = db.all("SELECT cost,meta FROM usageHistory ORDER BY id");
  expect(rows[0]).toEqual(first); expect(JSON.parse(first.meta).pricing.source).toBe("default");
  expect(JSON.parse(rows[1].meta).pricing).toEqual({source:"user",updatedAt:expect.stringMatching(/^\d{4}-/)});
  expect(rows[1].cost).toBe(0.015); expect(first.cost).not.toBe(rows[1].cost);
  expect(reports.analytics(all).tariffs).toHaveLength(2);
});

it("ranks exactly 20 groups on the sql.js fallback without a write transaction", async () => {
  const { createSqlJsAdapter } = await import("@/lib/db/adapters/sqljsAdapter.js");
  const { buildCreateTableSql, TABLES } = await import("@/lib/db/schema.js");
  const store = await createSqlJsAdapter(join(dir,"fallback.sqlite"));
  try {
    for (const t of ["apiKeys","retiredKeyFingerprints","providerNodes","usageHistory"]) store.exec(buildCreateTableSql(t,TABLES[t]));
    for (let i=0;i<22;i++) {
      for (let n=0;n<=i;n++) store.run("INSERT INTO usageHistory(timestamp,provider,status) VALUES(?,?,'error')",[at,"provider-"+i]);
    }
    const spy=vi.spyOn(store,"transaction");
    const rows=createUsageReports(store).analytics(all).breakdowns.provider;
    expect(spy).not.toHaveBeenCalled();
    expect(rows.map(r=>r.requests)).toEqual(Array.from({length:20},(_,i)=>22-i));
    expect(await usageExport(createUsageReports(store),all,"json").json()).toHaveLength(253);
  } finally { store.close(); }
});

it("keeps JSON valid across pages and excludes appends after the download starts", async () => {
  db.exec(`WITH RECURSIVE seq(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM seq WHERE i<300)
    INSERT INTO usageHistory(timestamp,requestId) SELECT '${at}',cast(i AS TEXT) FROM seq`);
  const response = usageExport(reports,all,"json");
  db.run("INSERT INTO usageHistory(timestamp,requestId) VALUES(?,'late')",[at]);
  const rows = await response.json();
  expect(rows.map(r=>r.requestId)).toEqual(Array.from({length:300},(_,i)=>String(i+1)));
});

it("aggregates 200k rows and exports incrementally under backpressure", async () => {
  db.exec(`WITH RECURSIVE seq(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM seq WHERE i<200000)
    INSERT INTO usageHistory(timestamp,model,status,meta) SELECT '${at}','m','ok',json_object('latencyMs',i) FROM seq`);
  const start = performance.now();
  const result = reports.analytics(all);
  expect(result.totals.requests).toBe(200000); expect(result.latencyMs.p99).toBe(198000);
  const ms = performance.now()-start;
  let maxPage = 0, pages = 0;
  const bounded = { ...db, all(query,args) {
    const rows = db.all(query,args);
    if (query.includes("FROM usageHistory")) { pages++; maxPage=Math.max(maxPage,rows.length); }
    return rows;
  } };
  const reader = usageExport(createUsageReports(bounded),all,"csv").body.getReader();
  expect(pages).toBe(0);
  let lines=0;
  while (true) {
    const {done,value} = await reader.read(); if (done) break;
    lines += new TextDecoder().decode(value).split("\r\n").length-1;
  }
  expect(lines).toBe(200001); expect(maxPage).toBeLessThanOrEqual(256); expect(pages).toBeGreaterThan(700);
  console.info("usage benchmark", { analyticsMs:Math.round(ms), totalMs:Math.round(performance.now()-start), maxPage, pages });
}, 60_000);

it("filters the entire report and download by current project, including retired keys", async () => {
  const blue = await repo.createApiKey("Blue key", "fixture", { project:"Blue", owner:"Dev", description:"Batch" });
  const other = await repo.createApiKey("Other", "fixture", { project:"ops@example.org", owner:"sk-private", description:"ops@example.org" });
  const rotated = await rotateApiKey(blue.id, 1);
  const oid = "openai-compatible-chat-fixture", aid = "anthropic-compatible-fixture";
  for (const [id,type,name] of [[oid,"openai-compatible","Fake"],[aid,"anthropic-compatible","Claude proxy"]]) {
    await repo.createProviderNode({id,type,name});
    db.run("INSERT INTO providerConnections(id,provider,authType,isActive,data,createdAt,updatedAt) VALUES(?,?,'apikey',1,'{}',?,?)",[id,id,at,at]);
  }
  for (const [raw,provider] of [[blue.key,oid],[rotated.key,aid],[other.key,aid]])
    db.run("INSERT INTO usageHistory(timestamp,provider,connectionId,apiKey,status,meta) VALUES(?,?,?,?,'error',?)",
      [at,provider,provider,fingerprint(raw),JSON.stringify({latencyMs: raw === other.key ? 999 : 5})]);
  const range = { ...all, project:"Blue" };
  const report = reports.analytics(range);
  expect(report.totals.requests).toBe(2);
  expect(report.latencyMs.p99).toBe(5);
  expect(report.timeSeries[0].requests).toBe(2);
  expect(report.heatmap[0].requests).toBe(2);
  expect(report.breakdowns.apiKey).toEqual([{ id:blue.id,name:"Blue key",project:"Blue",requests:2,tokens:0,cost:0,errorRate:1 }]);
  expect(report.breakdowns.provider.map(p => p.name).sort()).toEqual(["Claude proxy","Fake"]);
  expect(report.errorConnections.map(c => c.name)).toContain("Fake · openai-c");
  const rows = await usageExport(reports,range,"json").json();
  expect(rows.map(r => r.provider)).toEqual(["Fake","Claude proxy"]);
  expect(rows[0]).toMatchObject({ project:"Blue",owner:"Dev",description:"Batch" });
  expect((await usageExport(reports,all,"json").json()).at(-1)).toMatchObject({ project:null,owner:null,description:null });
  expect(reports.analytics({...all,project:"Unknown"}).totals.requests).toBe(0);
  const { providerHealth } = await import("@/lib/observability/providerHealth.js");
  expect((await providerHealth()).find(c => c.id===oid)).toMatchObject({provider:"Fake",name:"Fake · openai-c"});
  for (const name of ["secret@example.org","sk-private",""]) {
    db.run("UPDATE providerNodes SET name=? WHERE id=?", [name,oid]);
    expect(reports.analytics(range).breakdowns.provider.map(p => p.name)).toContain(oid);
    expect((await usageExport(reports,range,"json").json())[0].provider).toBe(oid);
    expect((await providerHealth()).find(c => c.id===oid).provider).toBe(oid);
  }
});
