import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import ProviderLimits from "../usage/components/ProviderLimits";

function QuotaPageFallback() {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 pb-6">
      <div className="border-b border-border/50 pb-3">
        <Skeleton className="h-7 w-28" />
        <Skeleton className="mt-2 h-3 max-w-xs" />
      </div>
      <Skeleton className="h-16 w-full rounded-md" />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Skeleton className="h-[180px] rounded-lg" />
        <Skeleton className="h-[180px] rounded-lg" />
      </div>
    </div>
  );
}

export default function QuotaPage() {
  return (
    <Suspense fallback={<QuotaPageFallback />}>
      <ProviderLimits />
    </Suspense>
  );
}
