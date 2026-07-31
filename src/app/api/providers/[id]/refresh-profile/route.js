import { NextResponse } from "next/server";
import { getProviderConnectionById, updateProviderConnection } from "@/models";
import { extractCodebuddyProfileFromToken } from "@/shared/utils/codebuddyProfile";
import {
  extractQoderworkProfileFromUserinfo,
  mergePersistedProfileData,
} from "@/shared/utils/qoderworkProfile";

export const dynamic = "force-dynamic";

/**
 * POST /api/providers/[id]/refresh-profile
 * - codebuddy-cn: JWT nickname + masked phone
 * - qoderwork-cn: userinfo name + optional phone-like mask
 */
export async function POST(_request, { params }) {
  try {
    const { id } = await params;
    const existing = await getProviderConnectionById(id);
    if (!existing) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    if (existing.authType !== "oauth") {
      return NextResponse.json(
        { error: "Only OAuth connections support profile refresh" },
        { status: 400 },
      );
    }

    const accessToken = existing.accessToken;
    if (!accessToken || typeof accessToken !== "string") {
      return NextResponse.json({ error: "Missing access token" }, { status: 401 });
    }

    if (existing.provider === "codebuddy-cn") {
      const profile = extractCodebuddyProfileFromToken(accessToken);
      if (!profile.nickname && !profile.phoneMasked) {
        return NextResponse.json(
          { error: "No profile fields found in token" },
          { status: 422 },
        );
      }
      const updateData = {
        providerSpecificData: mergePersistedProfileData(
          existing.providerSpecificData,
          {
            ...(profile.phoneMasked ? { phoneMasked: profile.phoneMasked } : {}),
          },
        ),
      };
      if (profile.nickname) updateData.name = profile.nickname;
      if (profile.sub) updateData.providerSpecificData.uid = profile.sub;
      const updated = await updateProviderConnection(id, updateData);
      if (!updated) {
        return NextResponse.json({ error: "Failed to update connection" }, { status: 500 });
      }
      const result = { ...updated };
      delete result.apiKey;
      delete result.accessToken;
      delete result.refreshToken;
      delete result.idToken;
      if (result.providerSpecificData?.phone) {
        const { phone, ...rest } = result.providerSpecificData;
        result.providerSpecificData = rest;
      }
      return NextResponse.json({ success: true, connection: result });
    }

    if (existing.provider === "qoderwork-cn") {
      const { QoderService } = await import("@/lib/oauth/services/qoder");
      const svc = new QoderService({ profile: "cn-work" });
      const userinfoRaw = await svc.fetchUserInfo(accessToken);
      // fetchUserInfo currently returns only name/email/org — call openapi for full body
      let full = null;
      try {
        const res = await fetch("https://openapi.qoder.com.cn/api/v1/userinfo", {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
            "User-Agent": "QoderWork",
          },
        });
        if (res.ok) full = await res.json();
      } catch {
        full = null;
      }
      if (!full) {
        full = {
          name: userinfoRaw?.name,
          email: userinfoRaw?.email,
          id: existing.providerSpecificData?.userId,
        };
      }
      const profile = extractQoderworkProfileFromUserinfo(full);

      const updateData = {
        providerSpecificData: mergePersistedProfileData(
          existing.providerSpecificData,
          {
            ...(profile.phoneMasked ? { phoneMasked: profile.phoneMasked } : {}),
          },
        ),
      };
      if (profile.displayName) {
        updateData.name = profile.displayName;
        updateData.displayName = profile.displayName;
      }
      if (profile.loginSource) {
        updateData.providerSpecificData.loginSource = profile.loginSource;
      }
      if (profile.userId) {
        updateData.providerSpecificData.userId = profile.userId;
      }

      const updated = await updateProviderConnection(id, updateData);
      if (!updated) {
        return NextResponse.json({ error: "Failed to update connection" }, { status: 500 });
      }
      const result = { ...updated };
      delete result.apiKey;
      delete result.accessToken;
      delete result.refreshToken;
      delete result.idToken;
      if (result.providerSpecificData?.phone) {
        const { phone, ...rest } = result.providerSpecificData;
        result.providerSpecificData = rest;
      }
      return NextResponse.json({
        success: true,
        connection: result,
      });
    }

    return NextResponse.json(
      { error: `Profile refresh not supported for provider ${existing.provider}` },
      { status: 400 },
    );
  } catch {
    console.error("Profile refresh failed");
    return NextResponse.json(
      { error: "Failed to refresh profile" },
      { status: 500 },
    );
  }
}
