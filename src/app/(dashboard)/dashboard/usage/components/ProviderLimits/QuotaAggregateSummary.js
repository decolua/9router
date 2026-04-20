"use client";

import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { getQuotaHealthStyles } from "./utils";

function BucketBar({ label, agg }) {
  if (!agg) {
    return (
      <div className="rounded-lg border border-dashed border-border/60 bg-muted/20 px-3 py-2.5">
        <p className="text-xs font-medium capitalize text-muted-foreground">
          {label}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">Không có dữ liệu</p>
      </div>
    );
  }

  const { remainingPct } = agg;
  const rem = getQuotaHealthStyles(remainingPct);

  return (
    <div className="space-y-2 rounded-lg border border-border/60 bg-muted/15 px-3 py-2.5 dark:bg-muted/10">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
        <span className="text-xs font-medium capitalize text-foreground">
          {label}
        </span>
        <span
          className={cn(
            "text-xs font-semibold tabular-nums leading-none",
            rem.text,
          )}
        >
          {remainingPct}%
        </span>
      </div>
      <Progress
        value={remainingPct}
        indicatorClassName={cn("rounded-full", rem.bar)}
        trackClassName="h-1.5"
      />
    </div>
  );
}

/**
 * Hai thanh tổng session / weekly (gộp mọi kết nối).
 */
export default function QuotaAggregateSummary({ aggregate }) {
  if (!aggregate || aggregate.kind !== "ok") {
    return (
      <Card size="sm" className="border-dashed shadow-none">
        <CardContent className="pt-4 text-xs leading-relaxed text-muted-foreground">
          Chưa có quota tên{" "}
          <code className="rounded-md bg-muted px-1 py-0.5 font-mono text-xs">
            session
          </code>{" "}
          hoặc{" "}
          <code className="rounded-md bg-muted px-1 py-0.5 font-mono text-xs">
            weekly
          </code>{" "}
          có trần số.
        </CardContent>
      </Card>
    );
  }

  const { session, weekly } = aggregate;

  return (
    <Card size="sm" className="shadow-sm ring-1 ring-border/60">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold leading-tight">
          Tổng session · weekly
        </CardTitle>
        <CardDescription className="text-xs leading-snug">
          Gộp theo tên quota trên mọi kết nối OAuth.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 pb-4 sm:grid-cols-2">
        <BucketBar label="session" agg={session} />
        <BucketBar label="weekly" agg={weekly} />
      </CardContent>
    </Card>
  );
}
