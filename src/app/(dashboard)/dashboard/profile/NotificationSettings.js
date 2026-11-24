"use client";

import { useEffect, useState } from "react";
import { Button, Input, Select, Toggle } from "@/shared/components";
import { SettingsCard } from "./SessionSettings";
import { translate } from "@/i18n/runtime";
import { EVENT_TYPES, eventLabels } from "@/shared/constants/notificationTypes";

const base = "/api/notifications/";
const field = "flex flex-col gap-1.5 text-sm font-medium";
const row = "flex flex-wrap items-center gap-3 border-b border-border-subtle py-2 text-sm last:border-0";

function Field({ title, name, ...props }) {
  return <Input id={`notify-${name}`} name={name} label={title} required {...props} />;
}

async function loadSettings(signal) {
  const res = await fetch(base + "settings", { cache: "no-store", signal });
  if (!res.ok) throw Error();
  return res.json();
}
export default function NotificationSettings() {
  const [data, setData] = useState(null);
  const [kind, setKind] = useState("webhook");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [allowHttp, setAllowHttp] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    loadSettings(controller.signal)
      .then(setData)
      .catch(() => {
        if (!controller.signal.aborted) setMessage("Could not load notifications");
      });
    return () => controller.abort();
  }, []);

  async function change(path, method, payload, reset) {
    setBusy(true);
    try {
      const res = await fetch(base + path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        setMessage(res.status === 429 ? "Channel rate limit reached" : "Notification action failed");
        return;
      }
      reset?.();
      setMessage(path.endsWith("/test") ? "Test notification sent" : "Changes saved");
      setData(await loadSettings());
    } catch {
      setMessage("Notification action failed");
    } finally {
      setBusy(false);
    }
  }
  function submit(path, method, numbers = [], reset = false) {
    return (e) => {
      e.preventDefault();
      const form = e.currentTarget,
        payload = Object.fromEntries(new FormData(form));
      for (const key of numbers) payload[key] = Number(payload[key]);
      if (path === "mutes" && payload.type === "all") payload.type = "";
      if (payload.allowInsecureLocal) payload.allowInsecureLocal = true;
      change(path, method, payload, reset ? () => form.reset() : null);
    };
  }
  return (
    <SettingsCard title="Notifications" icon="notifications" heading="h2">
      <div className="space-y-4">
        {message && <p role="status">{message}</p>}
        {data && (
          <fieldset disabled={busy} className="space-y-5">
            <legend className="sr-only">Notifications</legend>
            <div>
              <h3 id="notify-channels" className="mb-3 text-sm font-semibold sm:text-base">
                Delivery channels
              </h3>
              <ul>
                {data.channels.map((c) => (
                  <li key={c.id} className={row}>
                    <strong>{c.kind}</strong>
                    <code>{c.id.slice(0, 8)}</code>
                    <span>{c.perMinute}/min</span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => change("channels/test", "POST", { id: c.id })}
                    >
                      Send test notification
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => change("channels", "DELETE", { id: c.id })}
                    >
                      Delete channel
                    </Button>
                  </li>
                ))}
              </ul>
              <form
                method="post"
                action={base + "channels"}
                aria-labelledby="notify-channels"
                onReset={() => setAllowHttp(false)}
                className="mt-2 grid gap-3 sm:grid-cols-2"
                onSubmit={submit("channels", "POST", ["perMinute"], true)}
              >
                <div className={field}>
                  <label htmlFor="notify-kind">Channel</label>
                  <Select
                    id="notify-kind"
                    name="kind"
                    placeholder=""
                    selectClassName="[&>option:first-child]:hidden"
                    value={kind}
                    onChange={(event) => {
                      setKind(event.target.value);
                      setAllowHttp(false);
                    }}
                    options={[
                      { value: "webhook", label: "Webhook" },
                      { value: "telegram", label: "Telegram" },
                    ]}
                  />
                </div>
                <Field
                  title="Maximum sends per minute"
                  type="number"
                  name="perMinute"
                  defaultValue="10"
                  min="1"
                  max="120"
                />
                {kind === "webhook" ? (
                  <>
                    <Field title="Webhook URL" type="url" name="url" autoComplete="off" />
                    <Field
                      title="HMAC secret (optional)"
                      type="password"
                      name="secret"
                      autoComplete="new-password"
                      required={false}
                    />
                    <div className="flex items-center justify-between gap-4">
                      <label className="flex w-full items-center justify-between gap-4 text-sm font-medium">
                        <span>Allow HTTP to public addresses</span>
                        <Toggle checked={allowHttp} onChange={setAllowHttp} disabled={busy} />
                      </label>
                      {allowHttp && <input type="hidden" name="allowInsecureLocal" value="on" />}
                    </div>
                  </>
                ) : (
                  <>
                    <Field title="Bot token" type="password" name="token" autoComplete="new-password" />
                    <Field title="Chat ID" name="chatId" autoComplete="off" />
                  </>
                )}
                <Button type="submit" className="justify-self-start self-end">
                  Add channel
                </Button>
              </form>
            </div>
            <div className="border-t border-border-subtle pt-4">
              <h3 id="notify-thresholds" className="mb-3 text-sm font-semibold sm:text-base">
                Error thresholds (15 minutes)
              </h3>
              <form
                method="post"
                action={base + "settings"}
                aria-labelledby="notify-thresholds"
                className="grid gap-3 sm:grid-cols-3"
                onSubmit={submit("settings", "PATCH", ["minRequests", "errorPercent"])}
              >
                <Field
                  title="Minimum requests"
                  type="number"
                  min="1"
                  max="1000000"
                  name="minRequests"
                  defaultValue={data.thresholds.minRequests}
                />
                <Field
                  title="Error rate (%)"
                  type="number"
                  min="1"
                  max="100"
                  name="errorPercent"
                  defaultValue={data.thresholds.errorPercent}
                />
                <Button type="submit" className="justify-self-start self-end">
                  Save thresholds
                </Button>
              </form>
            </div>
            <div className="border-t border-border-subtle pt-4">
              <h3 id="notify-mutes" className="mb-3 text-sm font-semibold sm:text-base">
                Temporary mutes
              </h3>
              <ul>
                {data.mutes.map((m) => (
                  <li key={m.id} className={row}>
                    <span>{translate(eventLabels[m.type] || "All events")}</span>
                    <code>{m.target}</code>
                    <time>{new Date(m.untilAt).toLocaleString()}</time>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => change("mutes", "DELETE", { id: m.id })}
                    >
                      Unmute
                    </Button>
                  </li>
                ))}
              </ul>
              <form
                method="post"
                action={base + "mutes"}
                aria-labelledby="notify-mutes"
                className="grid gap-3 sm:grid-cols-2"
                onSubmit={submit("mutes", "POST", ["minutes"], true)}
              >
                <div className={field}>
                  <label htmlFor="notify-type">Event type</label>
                  <Select
                    id="notify-type"
                    name="type"
                    defaultValue="all"
                    placeholder=""
                    selectClassName="[&>option:first-child]:hidden"
                    options={[
                      { value: "all", label: "All events" },
                      ...EVENT_TYPES.map((type) => ({
                        value: type,
                        label: translate(eventLabels[type]),
                      })),
                    ]}
                  />
                </div>
                <Field title="Target from notification (optional)" name="target" required={false} />
                <Field
                  title="Mute duration (minutes)"
                  type="number"
                  name="minutes"
                  defaultValue="60"
                  min="1"
                  max="525600"
                />
                <Button type="submit" className="justify-self-start self-end">
                  Add mute
                </Button>
              </form>
            </div>
          </fieldset>
        )}
      </div>
    </SettingsCard>
  );
}
