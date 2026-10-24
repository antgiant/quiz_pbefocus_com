// Generates everything derived from the chapter files in questions/v1/by-chapter:
//   - manifest.json (books, chapters, verse/question counts, content hashes)
//   - packs/<year>.<hash>.json + packs/index.json (one pack per season)
//   - practice-years.bundle.js / practice-books.bundle.js (script-tag copies)
//
// Run `node scripts/build-data.mjs` after changing question or year data, or
// `--check` to fail when the generated files are stale. The GitHub Action in
// .github/workflows/build-data.yml does this on every data push.
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

export const MANIFEST_SCHEMA = "pbe.questions.manifest.v1";
export const PACK_SCHEMA = "pbe.year.pack.v1";
export const PACK_INDEX_SCHEMA = "pbe.year.pack.index.v1";

const HASH_LENGTH = 12;

export function normalizeBookKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function contentHash(value, length = HASH_LENGTH) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return createHash("sha256").update(text).digest("hex").slice(0, length);
}

function maxEndVerse(chapterJson) {
  return (chapterJson.questions || []).reduce(
    (max, question) => Math.max(max, Number(question?.ref?.endVerse) || 0),
    0
  );
}

// Book ids look like "41-mark" / "60-1-peter"; the practice files key books as "mark" / "1peter"
function practiceBookFor(bookId, practiceBooks) {
  const tail = normalizeBookKey(String(bookId).split("-").slice(1).join("-"));
  return practiceBooks?.[tail] || null;
}

/**
 * @param {Array<{bookId: string, number: number, json: object}>} chapters chapter files found on disk
 * @param {object|null} existing the current manifest.json, used to keep names and verse counts stable
 * @param {object|null} practiceBooks practice-books.json, the verse-count fallback for new chapters
 */
export function buildManifest(chapters, existing, practiceBooks) {
  const existingBooks = new Map((existing?.books || []).map((book) => [book.id, book]));
  const byBook = new Map();
  for (const chapter of chapters) {
    if (!byBook.has(chapter.bookId)) {
      byBook.set(chapter.bookId, []);
    }
    byBook.get(chapter.bookId).push(chapter);
  }

  const books = [...byBook.keys()]
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }))
    .map((bookId) => {
      const files = byBook.get(bookId).sort((a, b) => a.number - b.number);
      const previous = existingBooks.get(bookId);
      const previousChapters = new Map((previous?.chapters || []).map((item) => [item.number, item]));
      const practiceBook = practiceBookFor(bookId, practiceBooks);

      return {
        id: bookId,
        name: previous?.name || files[0].json.book || bookId,
        chapters: files.map(({ number, json }) => ({
          number,
          path: `by-chapter/${bookId}/${String(number).padStart(3, "0")}.json`,
          verses:
            previousChapters.get(number)?.verses ||
            practiceBook?.verseCounts?.[number - 1] ||
            maxEndVerse(json),
          questions: (json.questions || []).length,
          hash: contentHash(json),
        })),
      };
    });

  return { schema: MANIFEST_SCHEMA, version: existing?.version || 1, books };
}

/** Resolves a practice-years selection list to [{ bookId, number }] for chapters that have question data. */
export function resolvePracticeYear(selections, manifest) {
  const lookup = new Map();
  for (const book of manifest.books) {
    lookup.set(normalizeBookKey(book.name), book.id);
    lookup.set(normalizeBookKey(book.id.split("-").slice(1).join("-")), book.id);
  }
  const chaptersByBook = new Map(
    manifest.books.map((book) => [book.id, new Set(book.chapters.map((chapter) => chapter.number))])
  );

  const picked = new Map();
  for (const selection of Array.isArray(selections) ? selections : []) {
    const bookId = lookup.get(normalizeBookKey(selection?.bookKey));
    const start = Number(selection?.start);
    const end = Number(selection?.end);
    if (!bookId || !Number.isInteger(start) || !Number.isInteger(end)) {
      continue;
    }
    for (let number = Math.min(start, end); number <= Math.max(start, end); number += 1) {
      if (chaptersByBook.get(bookId).has(number)) {
        picked.set(`${bookId}:${number}`, { bookId, number });
      }
    }
  }
  return [...picked.values()];
}

/**
 * years.json entries only get a pack when they list an explicit scope; a year with no
 * scope means "everything", which is the custom whole-Bible case and stays unpacked.
 */
export function resolveScope(scope, manifest) {
  const chaptersByBook = new Map(
    manifest.books.map((book) => [book.id, new Set(book.chapters.map((chapter) => chapter.number))])
  );
  const picked = [];
  for (const [bookId, numbers] of Object.entries(scope || {})) {
    for (const number of Array.isArray(numbers) ? numbers : []) {
      if (chaptersByBook.get(bookId)?.has(Number(number))) {
        picked.push({ bookId, number: Number(number) });
      }
    }
  }
  return picked;
}

export function buildYearPacks({ practiceYears, years, manifest, chapterJson }) {
  const yearChapters = new Map();
  for (const [yearId, selections] of Object.entries(practiceYears || {})) {
    yearChapters.set(yearId, resolvePracticeYear(selections, manifest));
  }
  for (const year of years?.years || []) {
    if (year?.id && year.scope && typeof year.scope === "object") {
      yearChapters.set(year.id, resolveScope(year.scope, manifest));
    }
  }

  const packs = [];
  for (const [yearId, chapters] of [...yearChapters.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (chapters.length === 0) {
      continue;
    }
    const sorted = [...chapters].sort(
      (a, b) => a.bookId.localeCompare(b.bookId, "en", { numeric: true }) || a.number - b.number
    );
    const body = {};
    const hashes = {};
    let questions = 0;
    for (const { bookId, number } of sorted) {
      const key = `${bookId}:${number}`;
      body[key] = slimChapter(chapterJson.get(key));
      hashes[key] = manifest.books
        .find((book) => book.id === bookId)
        .chapters.find((chapter) => chapter.number === number).hash;
      questions += (body[key].questions || []).length;
    }

    const content = JSON.stringify({ schema: PACK_SCHEMA, yearId, hashes, chapters: body });
    const hash = contentHash(content);
    packs.push({
      yearId,
      file: `${safeFileName(yearId)}.${hash}.json`,
      content,
      entry: {
        path: `packs/${safeFileName(yearId)}.${hash}.json`,
        hash,
        chapters: sorted.length,
        questions,
        bytes: Buffer.byteLength(content),
        gzipBytes: gzipSync(content).length,
      },
    });
  }
  return packs;
}

// Fields the app never reads; leaving them out keeps packs smaller
const PACK_OMITTED_FIELDS = ["originalIds", "createdOn", "updatedOn"];

export function slimChapter(chapter) {
  return {
    ...chapter,
    questions: (chapter.questions || []).map((question) => {
      const slim = { ...question };
      for (const field of PACK_OMITTED_FIELDS) {
        delete slim[field];
      }
      return slim;
    }),
  };
}

function safeFileName(value) {
  return String(value).replace(/[^A-Za-z0-9._-]+/g, "-");
}

export function buildPackIndex(packs) {
  return {
    schema: PACK_INDEX_SCHEMA,
    version: 1,
    years: Object.fromEntries(packs.map((pack) => [pack.yearId, pack.entry])),
  };
}

// Files the app needs to start; precached as one versioned set by the service worker
const SHELL_DIRS = [
  ["assets/css", /\.css$/],
  ["assets/js", /\.js$/],
];
const SHELL_FILES = [
  "index.html",
  "favicon.ico",
  "assets/apple-touch-icon.png",
  "assets/hero-bible.webp",
  "assets/site-mark.svg",
  "assets/site-mark-dark.svg",
  "assets/vendor/compromise.min.js",
  "assets/vendor/jszip.min.js",
  "assets/vendor/spelling.js",
];

export async function buildServiceWorker(siteRoot, templateText) {
  const files = new Set(SHELL_FILES);
  for (const [dir, pattern] of SHELL_DIRS) {
    try {
      for (const name of await fs.readdir(path.join(siteRoot, dir))) {
        if (pattern.test(name)) files.add(`${dir}/${name}`);
      }
    } catch {
      // a site without this folder simply has nothing to precache from it
    }
  }

  const present = [];
  const hash = createHash("sha256").update(templateText);
  for (const file of [...files].sort()) {
    try {
      hash.update(file).update(await fs.readFile(path.join(siteRoot, file)));
      present.push(file);
    } catch {
      // optional files (an icon a fixture lacks) are left out of the precache
    }
  }

  return templateText
    .replace('"__VERSION__"', JSON.stringify(hash.digest("hex").slice(0, 10)))
    .replace("__SHELL__", JSON.stringify(present, null, 2));
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function readJsonIfExists(filePath) {
  try {
    return await readJson(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function scanChapters(v1Dir) {
  const root = path.join(v1Dir, "by-chapter");
  const chapters = [];
  for (const bookDir of (await fs.readdir(root, { withFileTypes: true })).filter((d) => d.isDirectory())) {
    for (const file of await fs.readdir(path.join(root, bookDir.name))) {
      const match = /^(\d+)\.json$/.exec(file);
      if (!match) {
        continue;
      }
      chapters.push({
        bookId: bookDir.name,
        number: Number(match[1]),
        json: await readJson(path.join(root, bookDir.name, file)),
      });
    }
  }
  return chapters;
}

export async function planOutputs(v1Dir) {
  const [existing, practiceYears, practiceBooks, years, chapters] = await Promise.all([
    readJsonIfExists(path.join(v1Dir, "manifest.json")),
    readJsonIfExists(path.join(v1Dir, "practice-chapters-by-year.json")),
    readJsonIfExists(path.join(v1Dir, "practice-books.json")),
    readJsonIfExists(path.join(v1Dir, "years.json")),
    scanChapters(v1Dir),
  ]);

  const manifest = buildManifest(chapters, existing, practiceBooks);
  const chapterJson = new Map(chapters.map((chapter) => [`${chapter.bookId}:${chapter.number}`, chapter.json]));
  const packs = buildYearPacks({ practiceYears, years, manifest, chapterJson });

  const outputs = new Map();
  outputs.set("manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
  outputs.set("packs/index.json", `${JSON.stringify(buildPackIndex(packs), null, 2)}\n`);
  for (const pack of packs) {
    outputs.set(`packs/${pack.file}`, pack.content);
  }
  const siteRoot = path.resolve(v1Dir, "..", "..");
  const templatePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "sw-template.js");
  outputs.set("../../sw.js", await buildServiceWorker(siteRoot, await fs.readFile(templatePath, "utf8")));
  // The practice files have no trailing newline, so the script-tag copies are built to match
  if (practiceYears) {
    outputs.set(
      "practice-years.bundle.js",
      `/* Auto-generated from practice-chapters-by-year.json */\nwindow.PBE_PRACTICE_YEARS = ${JSON.stringify(practiceYears, null, 2)};\n`
    );
  }
  if (practiceBooks) {
    outputs.set(
      "practice-books.bundle.js",
      `/* Auto-generated from practice-books.json */\nwindow.PBE_PRACTICE_BOOKS = ${JSON.stringify(practiceBooks, null, 2)};\n`
    );
  }
  return { outputs, packs, manifest };
}

async function listExistingPacks(v1Dir) {
  try {
    return (await fs.readdir(path.join(v1Dir, "packs"))).map((name) => `packs/${name}`);
  } catch {
    return [];
  }
}

export async function main(argv = process.argv.slice(2), v1Dir = path.join(process.cwd(), "questions", "v1")) {
  const check = argv.includes("--check");
  const { outputs, packs } = await planOutputs(v1Dir);
  const stale = [];

  for (const [relPath, content] of outputs) {
    const target = path.join(v1Dir, relPath);
    let current = null;
    try {
      current = await fs.readFile(target, "utf8");
    } catch {
      current = null;
    }
    if (current === content) {
      continue;
    }
    stale.push(relPath);
    if (!check) {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, content, "utf8");
    }
  }

  // Old pack versions are dead weight once the manifest points at the new hash
  for (const relPath of await listExistingPacks(v1Dir)) {
    if (!outputs.has(relPath)) {
      stale.push(relPath);
      if (!check) {
        await fs.rm(path.join(v1Dir, relPath));
      }
    }
  }

  for (const pack of packs) {
    const { chapters, questions, bytes, gzipBytes } = pack.entry;
    console.log(
      `${pack.yearId}: ${chapters} chapters, ${questions} questions, ${(bytes / 1024).toFixed(0)} KB (${(gzipBytes / 1024).toFixed(0)} KB gzip)`
    );
  }

  if (check) {
    if (stale.length) {
      console.error(`Generated data is out of date:\n  ${stale.join("\n  ")}\nRun: npm run build:data`);
      process.exitCode = 1;
    } else {
      console.log("Generated data is up to date.");
    }
  } else {
    console.log(stale.length ? `Updated ${stale.length} file(s).` : "Nothing to update.");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
