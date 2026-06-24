import { promises as fs } from "node:fs";
import path from "node:path";

const root = process.cwd();
const v1Dir = path.join(root, "questions", "v1");
const manifestPath = path.join(v1Dir, "manifest.json");
const yearsPath = path.join(v1Dir, "years.json");
const outPath = path.join(v1Dir, "local-data.bundle.js");
const templatePptxPath = path.join(root, "2023-NAD-PBE-Practice-Test.pptx");
const templateBundleOutPath = path.join(root, "assets", "vendor", "pptx-template.bundle.js");

async function readJson(filePath) {
  const text = await fs.readFile(filePath, "utf8");
  return JSON.parse(text);
}

async function readJsonIfExists(filePath) {
  try {
    return await readJson(filePath);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const manifest = await readJson(manifestPath);
  let years = null;
  try {
    years = await readJson(yearsPath);
  } catch {
    years = null;
  }

  const chapters = {};
  const skipped = [];
  for (const book of manifest.books || []) {
    for (const chapter of book.chapters || []) {
      const relPath = chapter.path;
      const absPath = path.join(v1Dir, relPath);
      const chapterJson = await readJsonIfExists(absPath);
      if (!chapterJson) {
        skipped.push(relPath);
        continue;
      }
      chapters[`${book.id}:${chapter.number}`] = chapterJson;
    }
  }

  const payload = {
    schema: "pbe.local.bundle.v1",
    generatedAt: new Date().toISOString(),
    manifest,
    years,
    chapters,
  };

  const content = `/* Auto-generated. Run: node scripts/build-local-bundle.mjs */\nwindow.PBE_LOCAL_DATA = ${JSON.stringify(
    payload
  )};\n`;

  await fs.writeFile(outPath, content, "utf8");
  console.log(`Wrote ${outPath}`);

  if (await fileExists(templatePptxPath)) {
    const templateBytes = await fs.readFile(templatePptxPath);
    const templateBase64 = templateBytes.toString("base64");
    const templateBundle =
      "/* Auto-generated. Run: node scripts/build-local-bundle.mjs */\n" +
      `window.PBE_TEMPLATE_PPTX_BASE64 = "${templateBase64}";\n`;
    await fs.writeFile(templateBundleOutPath, templateBundle, "utf8");
    console.log(`Wrote ${templateBundleOutPath}`);
  } else {
    console.log(`Skipped ${templateBundleOutPath}; missing optional ${templatePptxPath}`);
  }

  if (skipped.length) {
    console.log(`Skipped missing chapters: ${skipped.join(", ")}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
