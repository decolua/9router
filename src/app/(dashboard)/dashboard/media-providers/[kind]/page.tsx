import MediaProviderKindPageClient from "./MediaProviderKindPageClient";
import React from "react";

export default async function MediaProviderKindPage(props: { params: Promise<{ kind: string }> }) {
  const { kind } = await props.params;
  return <MediaProviderKindPageClient kind={kind} />;
}
