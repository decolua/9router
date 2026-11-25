"use client";

import { useEffect, useState } from "react";
import Badge from "../Badge";
import Card from "../Card";
import { ProjectFilter, ProjectBadge } from "../KeyProject";

const totals = {
  totalRequests: "Requests",
  totalPromptTokens: "Input tokens",
  totalCompletionTokens: "Output tokens",
  totalCachedTokens: "Cached tokens",
  totalCost: "Estimated cost",
};

export default function ViewerPage({ page }) {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const [project, setProject] = useState("");
  useEffect(() => {
    if (!page) return;
    const controller = new AbortController();
    fetch(page.api, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const value = await response.json();
        if (!controller.signal.aborted) setData(value);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [page]);
  if (!page) return <Card icon="lock" title="Administrator access required" />;
  if (failed)
    return (
      <Card>
        <p role="alert">Could not load summary</p>
      </Card>
    );
  if (!data)
    return (
      <Card>
        <p role="status">Loading...</p>
      </Card>
    );

  return (
    <Card
      title={page.title}
      icon={data.keys ? "api" : data.providers ? "dns" : data.combos ? "layers" : "bar_chart"}
    >
      {data.keys && (
        <>
          <ProjectFilter keys={data.keys} value={project} onChange={setProject} />
          {!data.keys.length && <p className="text-sm text-text-muted">No API keys yet</p>}
          <ul className="divide-y divide-border/50">
            {data.keys
              .filter((key) => !project || key.project === project)
              .map((key) => (
                <li
                  key={key.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
                >
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <strong className="break-all" data-i18n-skip>
                      {key.name}
                    </strong>
                    <ProjectBadge project={key.project} />
                    <span className="break-all text-text-muted" data-i18n-skip>
                      {key.owner}
                    </span>
                  </div>
                  <Badge size="sm" variant={key.isActive ? "success" : "warning"} dot>
                    {key.isActive ? "Active" : "Paused"}
                  </Badge>
                </li>
              ))}
          </ul>
        </>
      )}
      {data.providers && (
        <ul className="divide-y divide-border/50">
          {data.providers.map((provider) => (
            <li key={provider.provider} className="flex items-center justify-between gap-3 py-3 text-sm">
              <strong data-i18n-skip>{provider.provider}</strong>
              <Badge size="sm" variant={provider.active ? "success" : "default"}>
                {provider.active}/{provider.total} <span>Active</span>
              </Badge>
            </li>
          ))}
        </ul>
      )}
      {data.combos && (
        <ul className="divide-y divide-border/50">
          {data.combos.map((combo) => (
            <li
              key={combo.id}
              className="flex flex-wrap items-baseline justify-between gap-2 py-3 text-sm"
              data-i18n-skip
            >
              <strong>{combo.name}</strong>
              <span className="break-all text-text-muted">{combo.models.join(", ")}</span>
            </li>
          ))}
        </ul>
      )}
      {data.totalRequests != null && (
        <>
          <p className="mb-2 text-sm text-text-muted">Last 7 days</p>
          <dl className="divide-y divide-border/50">
            {Object.entries(totals).map(([key, label]) => (
              <div key={key} className="flex items-baseline justify-between gap-3 py-2 text-sm">
                <dt className="text-text-muted">{label}</dt>
                <dd className="font-semibold tabular-nums">{data[key]}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </Card>
  );
}
