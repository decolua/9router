"use client";

import { ProfileAppInfo } from "./components/ProfileAppInfo";
import { ProfileLocalBackupCard } from "./components/ProfileLocalBackupCard";
import { ProfileNetworkCard } from "./components/ProfileNetworkCard";
import { ProfileObservabilityCard } from "./components/ProfileObservabilityCard";
import { ProfileOidcCard } from "./components/ProfileOidcCard";
import { ProfileRoutingCard } from "./components/ProfileRoutingCard";
import { ProfileSecurityCard } from "./components/ProfileSecurityCard";
import { useProfileSettings } from "./hooks/useProfileSettings";

export default function ProfilePage() {
  const profile = useProfileSettings();

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-0">
      <div className="flex flex-col gap-6">
        <ProfileLocalBackupCard {...profile.localBackup} />
        <ProfileSecurityCard {...profile.security} />
        <ProfileOidcCard {...profile.oidc} />
        <ProfileRoutingCard {...profile.routing} />
        <ProfileNetworkCard {...profile.network} />
        <ProfileObservabilityCard {...profile.observability} />
        <ProfileAppInfo />
      </div>
    </div>
  );
}
