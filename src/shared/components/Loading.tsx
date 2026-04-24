"use client";

import * as React from "react";
import { Skeleton as ShadcnSkeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

interface SpinnerProps {
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}

// Spinner loading
export function Spinner({ size = "md", className }: SpinnerProps) {
  const sizes = {
    sm: "size-4",
    md: "size-6",
    lg: "size-8",
    xl: "size-12",
  };

  return (
    <Loader2
      className={cn(
        "animate-spin text-primary",
        sizes[size],
        className
      )}
    />
  );
}

// Full page loading
export function PageLoading({ message = "Loading..." }: { message?: string }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background">
      <Spinner size="xl" />
      <p className="mt-4 text-muted-foreground">{message}</p>
    </div>
  );
}

// Skeleton loading
export function Skeleton({ className, ...props }: React.ComponentProps<typeof ShadcnSkeleton>) {
  return (
    <ShadcnSkeleton
      className={cn("rounded-lg", className)}
      {...props}
    />
  );
}

// Card skeleton
export function CardSkeleton() {
  return (
    <div className="p-6 rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between mb-4">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="size-10 rounded-lg" />
      </div>
      <Skeleton className="h-8 w-16 mb-2" />
      <Skeleton className="h-3 w-20" />
    </div>
  );
}

interface LoadingProps {
  type?: "spinner" | "page" | "skeleton" | "card";
  [key: string]: any;
}

// Default export
export default function Loading({ type = "spinner", ...props }: LoadingProps) {
  switch (type) {
    case "page":
      return <PageLoading {...props} />;
    case "skeleton":
      return <Skeleton className={props.className} {...props} />;
    case "card":
      return <CardSkeleton />;
    default:
      return <Spinner {...props} />;
  }
}
