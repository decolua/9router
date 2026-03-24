import { Suspense } from "react";
import { CardSkeleton } from "@/shared/components/Loading";
import ProviderLimits from "../usage/components/ProviderLimits";

export default function QuotaPage() {
  return (
    <Suspense fallback={<CardSkeleton />}>
      <ProviderLimits />
    </Suspense>
  );
}
