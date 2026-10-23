// Builds a Bible-scale copy of the site so load speed can be measured as the question
// bank grows. Real chapters are cloned (with fresh ids) into synthetic books until the
// bank has --chapters chapters; the real seasons and their packs are left untouched.
//
//   node scripts/bench/make-fixture.mjs --src . --out /tmp/fixture --chapters 1189
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

const src = path.resolve(arg("src", repoRoot));
const out = path.resolve(arg("out", ""));
const targetChapters = Number(arg("chapters", 1189));
if (!arg("out")) {
  console.error("usage: make-fixture.mjs --out <dir> [--src <site>] [--chapters 1189]");
  process.exit(2);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const entry of ["index.html", "assets", "questions", "scripts", "favicon.ico", "sw.js"]) {
  if (existsSync(path.join(src, entry))) {
    cpSync(path.join(src, entry), path.join(out, entry), { recursive: true });
  }
}
rmSync(path.join(out, "questions", "v1", "packs"), { recursive: true, force: true });

const v1 = path.join(out, "questions", "v1");
const realDirs = readdirSync(path.join(v1, "by-chapter"));
const realFiles = realDirs.flatMap((dir) =>
  readdirSync(path.join(v1, "by-chapter", dir)).map((file) => path.join(v1, "by-chapter", dir, file))
);

let chapters = realFiles.length;
let book = 0;
while (chapters < targetChapters) {
  book += 1;
  const bookId = `${100 + book}-synthetic-${book}`;
  const dir = path.join(v1, "by-chapter", bookId);
  mkdirSync(dir, { recursive: true });
  for (let number = 1; number <= 40 && chapters < targetChapters; number += 1) {
    const template = JSON.parse(readFileSync(realFiles[chapters % realFiles.length], "utf8"));
    template.bookId = bookId;
    template.book = `Synthetic ${book}`;
    template.chapter = number;
    template.questions = template.questions.map((question, index) => ({
      ...question,
      id: `${bookId}-${number}-${index}`,
    }));
    writeFileSync(path.join(dir, `${String(number).padStart(3, "0")}.json`), JSON.stringify(template, null, 2));
    chapters += 1;
  }
}

// Old checkouts have no manifest hashes or packs: regenerate the manifest with this
// repo's builder (it keeps names and verse counts), and the legacy script bundle with
// the checkout's own builder so every version sees the same data.
const { main } = await import(pathToFileURL(path.join(repoRoot, "scripts", "build-data.mjs")).href);
await main([], v1);
const bundleScript = path.join(src, "scripts", "build-local-bundle.mjs");
if (existsSync(bundleScript)) {
  execFileSync("node", [bundleScript], { cwd: out, stdio: "inherit" });
}
console.log(`Fixture at ${out}: ${chapters} chapters`);
