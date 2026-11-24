import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { parseTOML, stringifyTOML } from "confbox";
import { resolveContextWindow, syncCodexCatalog, restartCodexDaemon } from "@/lib/codexCatalog";

export const dynamic = "force-dynamic";

const getCodexDir = () => path.join(os.homedir(), ".codex");

const isValidProfileName = (name) => {
  return typeof name === "string" && /^[a-zA-Z0-9_-]+$/.test(name) && name.length <= 64 && name.toLowerCase() !== "config";
};

const isValidModel = (model) => {
  return typeof model === "string" && model.trim().length > 0 && model.length <= 256 && !/[\r\n"]/.test(model);
};

const toLimit = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n <= 100000000 ? n : NaN;
};

const readLimit = (content, key) => {
  const match = content.match(new RegExp(`^\\s*${key}\\s*=\\s*(\\d+)\\s*$`, "m"));
  return match ? Number(match[1]) : null;
};

// GET - List all custom profiles from ~/.codex/*.config.toml
export async function GET() {
  try {
    const codexDir = getCodexDir();
    let files = [];
    try {
      files = await fs.readdir(codexDir);
    } catch (err) {
      if (err.code === "ENOENT") return NextResponse.json({ profiles: [] });
      throw err;
    }

    const profileFiles = files.filter(
      (file) => file.endsWith(".config.toml") && file !== "config.toml"
    );

    const profiles = await Promise.all(
      profileFiles.map(async (file) => {
        const name = file.replace(/\.config\.toml$/, "");
        try {
          const content = await fs.readFile(path.join(codexDir, file), "utf-8");
          const match = content.match(/^\s*model\s*=\s*(["'])([^"\n]+)\1/m);
          return {
            name,
            model: match ? match[2] : "",
            contextWindow: readLimit(content, "model_context_window"),
            command: `codex -p ${name}`,
          };
        } catch {
          return { name, model: "", contextWindow: null, command: `codex -p ${name}` };
        }
      })
    );

    profiles.sort((a, b) => a.name.localeCompare(b.name));
    return NextResponse.json({ profiles });
  } catch (error) {
    console.error("Error reading codex profiles:", error);
    return NextResponse.json({ error: "Failed to read profiles" }, { status: 500 });
  }
}

// POST - Create or update a profile ~/.codex/<name>.config.toml
export async function POST(request) {
  try {
    const { name, model, contextWindow } = await request.json();

    const cleanName = typeof name === "string" ? name.trim().toLowerCase() : "";
    if (!isValidProfileName(cleanName)) {
      return NextResponse.json(
        { error: "Profile name can only contain alphanumeric characters, dashes, underscores and cannot be 'config'" },
        { status: 400 }
      );
    }

    const cleanModel = typeof model === "string" ? model.trim() : "";
    if (!isValidModel(cleanModel)) {
      return NextResponse.json({ error: "Invalid model name" }, { status: 400 });
    }

    const cleanContextWindow = toLimit(contextWindow);
    if (Number.isNaN(cleanContextWindow)) {
      return NextResponse.json({ error: "Context window must be a positive integer" }, { status: 400 });
    }

    const codexDir = getCodexDir();
    await fs.mkdir(codexDir, { recursive: true });

    const filePath = path.join(codexDir, `${cleanName}.config.toml`);
    let content = `# codex -p ${cleanName}\nmodel = "${cleanModel}"\nmodel_provider = "9router"\n`;
    if (cleanContextWindow) content += `model_context_window = ${cleanContextWindow}\n`;
    await fs.writeFile(filePath, content, "utf-8");

    const catalogPath = await syncCodexCatalog({
      codexDir,
      models: [{ slug: cleanModel, contextWindow: resolveContextWindow(cleanContextWindow, cleanModel) }],
    });
    if (catalogPath) {
      try {
        const configPath = path.join(codexDir, "config.toml");
        const config = parseTOML(await fs.readFile(configPath, "utf-8")) || {};
        if (config.model_catalog_json !== catalogPath) {
          config.model_catalog_json = catalogPath;
          await fs.writeFile(configPath, stringifyTOML(config), "utf-8");
        }
      } catch {
      }
      await restartCodexDaemon();
    }

    return NextResponse.json({
      success: true,
      profile: {
        name: cleanName,
        model: cleanModel,
        contextWindow: cleanContextWindow,
        command: `codex -p ${cleanName}`,
      },
    });
  } catch (error) {
    console.error("Error saving codex profile:", error);
    return NextResponse.json({ error: "Failed to save profile" }, { status: 500 });
  }
}

// DELETE - Remove a profile ~/.codex/<name>.config.toml
export async function DELETE(request) {
  try {
    const { name } = await request.json();
    const cleanName = typeof name === "string" ? name.trim().toLowerCase() : "";

    if (!isValidProfileName(cleanName)) {
      return NextResponse.json({ error: "Invalid profile name" }, { status: 400 });
    }

    const filePath = path.join(getCodexDir(), `${cleanName}.config.toml`);
    try {
      await fs.unlink(filePath);
    } catch (err) {
      if (err.code === "ENOENT") {
        return NextResponse.json({ error: "Profile not found" }, { status: 404 });
      }
      throw err;
    }

    return NextResponse.json({ success: true, message: `Profile ${cleanName} deleted` });
  } catch (error) {
    console.error("Error deleting codex profile:", error);
    return NextResponse.json({ error: "Failed to delete profile" }, { status: 500 });
  }
}
