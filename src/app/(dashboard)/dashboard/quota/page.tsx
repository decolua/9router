"use client";

import React, { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import ProviderLimits from "../usage/components/ProviderLimits";

function QuotaPageFallback() {
 return (
 <div className="mx-auto flex max-w-5xl flex-col gap-6 p-4 lg:p-6">
 <div className="flex items-center justify-between">
 <div className="flex flex-col gap-2">
 <Skeleton className="h-8 w-48 rounded-none"/>
 <Skeleton className="h-3 w-32 rounded-none opacity-40"/>
 </div>
 <div className="flex gap-2">
 <Skeleton className="h-9 w-32 rounded-none"/>
 <Skeleton className="h-9 w-9 rounded-none"/>
 </div>
 </div>
 
 <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
 <Skeleton className="h-32 rounded-none"/>
 <Skeleton className="h-32 rounded-none"/>
 </div>

 <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
 {Array.from({ length: 6 }).map((_, i) => (
 <Skeleton key={i} className="h-48 rounded-none"/>
 ))}
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
