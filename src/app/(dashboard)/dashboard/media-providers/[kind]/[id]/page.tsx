import MediaProviderDetailsClient from "./MediaProviderDetailsClient";
import React from "react";

export default async function MediaProviderDetailsPage(props: { params: Promise<{ kind: string, id: string }> }) {
  const { kind, id } = await props.params;
  return <MediaProviderDetailsClient kind={kind} providerId={id} />;
}
