import { NextResponse } from "next/server";

// Error validasi -> 400 dengan pesan (aman, pesan memang untuk user).
// Error internal -> 500 + pesan generik; path filesystem & stack hanya ke log server.
export function agentsErrorResponse(error, where) {
  if (Number(error?.status) === 400) {
    return NextResponse.json({ error: String(error?.message || error) }, { status: 400 });
  }
  console.log(`[agents] ${where} internal error:`, error);
  return NextResponse.json({ error: "terjadi kesalahan internal" }, { status: 500 });
}