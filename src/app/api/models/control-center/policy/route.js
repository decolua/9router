import { NextResponse } from "next/server";

import {
  OPERATOR_POLICY_STATES,
  getOperatorPolicy,
  listOperatorPolicies,
  setOperatorPolicy,
} from "@/lib/modelControlCenter/operatorPolicy.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { searchParams } =
      new URL(request.url);

    const providerAlias =
      searchParams.get("providerAlias");

    const modelId =
      searchParams.get("modelId");

    if (providerAlias || modelId) {
      if (!providerAlias || !modelId) {
        return NextResponse.json(
          {
            error:
              "providerAlias and modelId are both required",
          },
          {
            status: 400,
          },
        );
      }

      const policy =
        await getOperatorPolicy(
          providerAlias,
          modelId,
        );

      return NextResponse.json({
        states:
          OPERATOR_POLICY_STATES,
        policy,
      });
    }

    const policies =
      await listOperatorPolicies();

    return NextResponse.json({
      states:
        OPERATOR_POLICY_STATES,
      policies,
    });
  } catch (error) {
    console.log(
      "[modelControlCenter] policy read failed:",
      error,
    );

    return NextResponse.json(
      {
        error:
          error?.message
          || "Failed to read operator policy",
      },
      {
        status: 500,
      },
    );
  }
}

export async function PUT(request) {
  try {
    const body =
      await request.json();

    const policy =
      await setOperatorPolicy({
        providerAlias:
          body?.providerAlias,

        modelId:
          body?.modelId,

        state:
          body?.state,
      });

    return NextResponse.json({
      success: true,
      policy,
    });
  } catch (error) {
    console.log(
      "[modelControlCenter] policy update failed:",
      error,
    );

    return NextResponse.json(
      {
        error:
          error?.message
          || "Failed to update operator policy",
      },
      {
        status: 400,
      },
    );
  }
}
