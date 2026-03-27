import { NextResponse } from "next/server";
import { exec } from "child_process";
import { join, dirname } from "path";

// Use npm from the same Node.js that runs Next.js — ensures 9remote
// lands in the correct global bin (nvm or system, whichever is active)
const npmBin = join(dirname(process.execPath), "npm");

function installPackage() {
  return new Promise((resolve, reject) => {
    exec(`"${npmBin}" install -g 9remote`, { windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout);
    });
  });
}

export async function POST() {
  try {
    await installPackage();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
