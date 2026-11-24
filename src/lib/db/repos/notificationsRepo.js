import { getAdapter } from "../driver.js";
import { encryptChannel, decryptChannel } from "../helpers/keyEncryption.js";
import { connectionHealthRows } from "./providerHealthRepo.js";
import { getBudgetBalance } from "./budgetLedger.js";
import { requestWindowColumns } from "./requestWindowSql.js";
import { failed } from "./usageReportSql.js";

function inbox(db, before = null) {
  return { notifications: db.all(`SELECT id,type,target,label,severity,state,firstAt,lastAt,count,readAt FROM notifications
      WHERE (? IS NULL OR id<?) ORDER BY id DESC LIMIT 100`, [before, before]),
    unread: db.get("SELECT count(*) AS n FROM notifications WHERE readAt IS NULL").n };
}

const muted = (db, type, target, now) => db.get(`SELECT 1 FROM notificationMutes WHERE untilAt>?
  AND (type IS NULL OR type=?) AND (target IS NULL OR target=?) LIMIT 1`, [now, type, target]);

function enqueue(db, row, state, now) {
  db.run(`INSERT INTO notificationDeliveries(channel,event,severity,state,target,at)
    SELECT id,?,?,?,?,? FROM notificationChannels`, [row.type, row.severity, state, row.target, now]);
}

// Incident and outbound transitions commit together. Mutes never generate phantom recoveries.
function reconcile(db, now, activeIncidents, keepOpen) {
  db.transaction(() => {
    db.run("DELETE FROM notificationMutes WHERE untilAt<=?", [now]);
    const key = row => row.type + "|" + row.subject;
    const open = new Map(db.all("SELECT id,type,target,subject,severity FROM notifications WHERE state='open'").map(row => [key(row), row]));
    for (const row of activeIncidents()) {
      const prev = open.get(key(row));
      if (prev) {
        db.run("UPDATE notifications SET lastAt=?,count=count+1,label=? WHERE id=?", [now, row.label, prev.id]);
        open.delete(key(row));
      } else if (!muted(db, row.type, row.target, now)) {
        db.run(`INSERT INTO notifications(type,target,subject,label,severity,state,firstAt,lastAt)
          VALUES(?,?,?,?,?,'open',?,?)`, [row.type, row.target, row.subject, row.label, row.severity, now, now]);
        enqueue(db, row, "open", now);
      }
    }
    for (const row of open.values()) {
      if (keepOpen(row.type)) continue;
      db.run("UPDATE notifications SET state='resolved',lastAt=?,readAt=NULL WHERE id=?", [now, row.id]);
      enqueue(db, row, "resolved", now);
    }
  });
}

// Claim before network I/O: never repeat an ambiguous POST after a crash or timeout.
function claim(db, channel, now, test) {
  return db.transaction(() => {
    const used = db.get("SELECT count(*) AS n FROM notificationDeliveries WHERE channel=? AND attemptedAt>?",
      [channel.id, now - 60_000]).n;
    if (used >= channel.perMinute) return null;
    if (test) db.run(`INSERT INTO notificationDeliveries(channel,event,severity,state,target,at,attemptedAt)
      VALUES(?,'notification.test','info','open','gateway',?,?)`, [channel.id, now, now]);
    if (test) return { event: "notification.test", severity: "info", state: "open", target: "gateway", at: new Date(now).toISOString() };
    const row = db.get(`SELECT d.id,d.event,d.severity,d.state,d.target,d.at FROM notificationDeliveries d
      WHERE d.channel=? AND d.attemptedAt IS NULL AND NOT EXISTS (
        SELECT 1 FROM notificationMutes m WHERE m.untilAt>? AND (m.type IS NULL OR m.type=d.event)
        AND (m.target IS NULL OR m.target=d.target)) ORDER BY d.id LIMIT 1`, [channel.id, now]);
    if (!row) return null;
    db.run("UPDATE notificationDeliveries SET attemptedAt=? WHERE id=?", [now, row.id]);
    return { event: row.event, severity: row.severity, state: row.state, target: row.target, at: new Date(row.at).toISOString() };
  });
}

// Snapshot reads, incident transitions and delivery claims need synchronous access
// to the same connection. Only domain operations escape this repository.
export async function getNotificationsRepo() {
  const db = await getAdapter();
  return {
    claimTick(now, interval) {
      return db.run(`INSERT INTO _meta(key,value) VALUES('notificationTick',?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CAST(value AS INTEGER)<=?`,
        [String(now), now - interval + 100]).changes;
    },
    withSnapshot: read => db.transaction(read),
    activeKeys: now => db.all(`SELECT id,name,expiresAt,budget,${requestWindowColumns} FROM apiKeys WHERE isActive=1
    AND (expiresAt IS NULL OR expiresAt>=?)`, [new Date(now).toISOString()]),
    budgetBalance: (id, now) => getBudgetBalance(db, id, now),
    outages: () => db.all("SELECT * FROM notificationOutages"),
    connectionRows: () => connectionHealthRows(db),
    insertOutage: (subject, since) => db.run("INSERT INTO notificationOutages VALUES(?,?)", [subject, since]),
    deleteOutage: target => db.run("DELETE FROM notificationOutages WHERE target=?", [target]),
    recentUsage: now => db.get(`SELECT count(*) AS requests,coalesce(sum(${failed}),0) AS errors FROM usageHistory
    WHERE timestamp BETWEEN ? AND ?`, [new Date(now - 900_000).toISOString(), new Date(now).toISOString()]),

    inbox: before => inbox(db, before),
    markRead: (id, now) => db.run("UPDATE notifications SET readAt=coalesce(readAt,?) WHERE id=?", [now, id]),
    thresholds: () => JSON.parse(db.get("SELECT value FROM _meta WHERE key='notificationThresholds'")?.value ?? "null"),
    saveThresholds: value => db.run("INSERT OR REPLACE INTO _meta VALUES('notificationThresholds',?)", [JSON.stringify(value)]),
    channels: () => db.all("SELECT id,kind,perMinute FROM notificationChannels ORDER BY rowid"),
    insertChannel: (id, kind, config, perMinute) => db.run("INSERT INTO notificationChannels(id,kind,config,perMinute) VALUES(?,?,?,?)",
      [id, kind, encryptChannel(db, id, kind, config), perMinute]),
    deleteChannel: id => db.run("DELETE FROM notificationChannels WHERE id=?", [id]).changes,
    mutes: now => db.all("SELECT id,type,target,untilAt FROM notificationMutes WHERE untilAt>? ORDER BY untilAt", [now]),
    insertMute: (type, target, until) => db.run("INSERT INTO notificationMutes(type,target,untilAt) VALUES(?,?,?)", [type, target, until]),
    deleteMute: id => db.run("DELETE FROM notificationMutes WHERE id=?", [id]).changes,

    reconcile: (now, activeIncidents, keepOpen) => reconcile(db, now, activeIncidents, keepOpen),
    claim: (channel, now, test) => claim(db, channel, now, test),
    channel: id => db.get("SELECT * FROM notificationChannels WHERE id=?", [id]),
    deliveryChannels: () => db.all("SELECT * FROM notificationChannels"),
    channelConfig: channel => decryptChannel(db, channel),
    pruneDeliveries: cutoff => db.run("DELETE FROM notificationDeliveries WHERE attemptedAt<=?", [cutoff]),
  };
}
