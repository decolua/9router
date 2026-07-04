import { NextResponse } from "next/server";

import { requestPasswordReset } from "@/lib/auth/passwordReset";

import { auditFromRequest, AuditAction } from "@/lib/audit";

import { requireOrgFromRequest, runWithRequestOrg } from "@/lib/org/orgContext.js";



export async function POST(request) {

  return runWithRequestOrg(request, async () => {

    try {

      const { org, error: orgError } = await requireOrgFromRequest(request);

      if (orgError) return orgError;



      const { email } = await request.json();

      const normalizedEmail = String(email || "").trim().toLowerCase();

      if (!normalizedEmail) {

        return NextResponse.json({ error: "Email is required" }, { status: 400 });

      }



      await requestPasswordReset(normalizedEmail, { orgId: org.id, request });

      await auditFromRequest(request, {

        action: AuditAction.PASSWORD_RESET_REQUESTED,

        actorEmail: normalizedEmail,

        targetType: "user",

        outcome: "success",

        meta: { orgId: org.id },

      });



      return NextResponse.json({

        success: true,

        message: "If an account exists for that email, a reset link has been sent or can be issued by an admin.",

      });

    } catch (error) {

      return NextResponse.json({ error: error.message }, { status: 500 });

    }

  });

}

