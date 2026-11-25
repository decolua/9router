import { Suspense } from "react";
import { CardSkeleton } from "@/shared/components/Loading";
import ProviderLimits from "../usage/components/ProviderLimits";
import QuotaResetNotifyCard from "./QuotaResetNotifyCard";

export default function QuotaPage() {
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Suspense fallback={<CardSkeleton />}>
        <ProviderLimits />
      </Suspense>
      <QuotaResetNotifyCard />
    </div>
  );
}
