import { NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/localDb";
import { getConsistentMachineId } from "@/shared/utils/machineId";

const CLI_TOKEN_HEADER = "x-9r-cli-token";
const CLI_TOKEN_SALT = "9r-cli-auth";

async function getCliToken() {
  return await getConsistentMachineId(CLI_TOKEN_SALT);
}

async function hasValidCliToken(request) {
  const token = request.headers.get(CLI_TOKEN_HEADER);
  if (!token) return false;
  return token === await getCliToken();
}

const DEFAULT_PASSWORD = "123456";

export async function POST(request) {
  try {
    if (!(await hasValidCliToken(request))) {
      return NextResponse.json({ error: "CLI token required" }, { status: 403 });
    }

    const settings = await getSettings();
    
    if (!settings.password) {
      return NextResponse.json({ 
        success: true, 
        message: "No custom password set. Default password already active." 
      });
    }

    await updateSettings({ password: undefined });

    return NextResponse.json({ 
      success: true, 
      message: `Password reset to default: ${DEFAULT_PASSWORD}` 
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}