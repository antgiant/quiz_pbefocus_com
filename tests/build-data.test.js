import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildManifest,
  buildPackIndex,
  buildYearPacks,
  contentHash,
  planOutputs,
  resolvePracticeYear,
} from "../scripts/build-data.mjs";

function chapter(bookId, number, ends, bookName = "Mark") {
  return {
    bookId,
    number,
    json: {
      book: bookName,
      chapter: number,
      questions: ends.map((endVerse, index) => ({ id: `${bookId}-${number}-${index}`, ref: { startVerse: 1, endVerse } })),
    },
  };
}

const CHAPTERS = [
  chapter("41-mark", 2, [3, 5]),
  chapter("41-mark", 1, [2]),
  chapter("60-1-peter", 1, [4], "1 Peter"),
];
const PRACTICE_BOOKS = { "1peter": { verseCounts: [25, 25] } };

describe("buildManifest", () => {
  it("lists books and chapters in order with counts and content hashes", () => {
    const manifest = buildManifest(CHAPTERS, null, PRACTICE_BOOKS);

    expect(manifest.books.map((book) => book.id)).toEqual(["41-mark", "60-1-peter"]);
    expect(manifest.books[0].chapters.map((item) => item.number)).toEqual([1, 2]);
    expect(manifest.books[0].chapters[1]).toMatchObject({
      path: "by-chapter/41-mark/002.json",
      questions: 2,
      verses: 5,
    });
    expect(manifest.books[0].chapters[1].hash).toBe(contentHash(CHAPTERS[0].json));
  });

  it("takes verse counts from the practice books for new chapters and keeps existing ones", () => {
    const existing = {
      version: 1,
      books: [{ id: "41-mark", name: "Mark", chapters: [{ number: 1, verses: 45 }] }],
    };
    const manifest = buildManifest(CHAPTERS, existing, PRACTICE_BOOKS);

    expect(manifest.books[0].chapters[0].verses).toBe(45);
    expect(manifest.books[1].chapters[0].verses).toBe(25);
  });

  it("changes a chapter hash only when that chapter changes", () => {
    const before = buildManifest(CHAPTERS, null, PRACTICE_BOOKS);
    const edited = structuredClone(CHAPTERS);
    edited[0].json.questions[0].question = "edited";
    const after = buildManifest(edited, null, PRACTICE_BOOKS);

    expect(after.books[0].chapters[1].hash).not.toBe(before.books[0].chapters[1].hash);
    expect(after.books[0].chapters[0].hash).toBe(before.books[0].chapters[0].hash);
    expect(after.books[1].chapters[0].hash).toBe(before.books[1].chapters[0].hash);
  });
});

describe("year packs", () => {
  const manifest = buildManifest(CHAPTERS, null, PRACTICE_BOOKS);
  const chapterJson = new Map(CHAPTERS.map((item) => [`${item.bookId}:${item.number}`, item.json]));

  it("resolves selections by book key and drops chapters without data", () => {
    const picked = resolvePracticeYear(
      [
        { bookKey: "mark", start: 1, end: 5 },
        { bookKey: "1peter", start: 1, end: 1 },
        { bookKey: "genesis", start: 1, end: 3 },
      ],
      manifest
    );

    expect(picked).toEqual([
      { bookId: "41-mark", number: 1 },
      { bookId: "41-mark", number: 2 },
      { bookId: "60-1-peter", number: 1 },
    ]);
  });

  it("packs only years that have data and indexes them by hash", () => {
    const packs = buildYearPacks({
      practiceYears: {
        "2026-2027": [{ bookKey: "mark", start: 1, end: 2 }],
        "2033-2034": [{ bookKey: "genesis", start: 1, end: 33 }],
      },
      years: { years: [{ id: "2026-current", name: "2026-2027" }] },
      manifest,
      chapterJson,
    });

    expect(packs.map((pack) => pack.yearId)).toEqual(["2026-2027"]);
    const pack = JSON.parse(packs[0].content);
    expect(Object.keys(pack.chapters)).toEqual(["41-mark:1", "41-mark:2"]);
    expect(pack.hashes["41-mark:2"]).toBe(manifest.books[0].chapters[1].hash);
    expect(packs[0].entry).toMatchObject({ chapters: 2, questions: 3 });
    expect(buildPackIndex(packs).years["2026-2027"].path).toBe(`packs/${packs[0].file}`);
  });

  it("builds a pack for a years.json entry with an explicit scope", () => {
    const packs = buildYearPacks({
      practiceYears: {},
      years: { years: [{ id: "custom", name: "Custom", scope: { "60-1-peter": [1, 9] } }] },
      manifest,
      chapterJson,
    });

    expect(Object.keys(JSON.parse(packs[0].content).chapters)).toEqual(["60-1-peter:1"]);
  });

  it("gives the same pack for the same data", () => {
    const args = {
      practiceYears: { y: [{ bookKey: "mark", start: 1, end: 2 }] },
      years: null,
      manifest,
      chapterJson,
    };
    expect(buildYearPacks(args)[0].file).toBe(buildYearPacks(args)[0].file);
  });
});

describe("committed question data", () => {
  it("is up to date with the chapter files (run npm run build:data)", async () => {
    const v1Dir = path.join(process.cwd(), "questions", "v1");
    const { outputs } = await planOutputs(v1Dir);
    const fs = await import("node:fs/promises");

    for (const [relPath, content] of outputs) {
      // sw.js tracks every app file, so the Action refreshes it instead of failing each edit
      if (relPath.endsWith("sw.js")) continue;
      const current = await fs.readFile(path.join(v1Dir, relPath), "utf8");
      expect(current === content, `${relPath} is stale`).toBe(true);
    }
  });

  it("defines the upcoming seasons", async () => {
    const fs = await import("node:fs/promises");
    const years = JSON.parse(await fs.readFile("questions/v1/practice-chapters-by-year.json", "utf8"));
    const keys = (year) => years[year].map((selection) => selection.bookKey);

    expect(keys("2027-2028")).toEqual(["isaiah"]);
    expect(keys("2028-2029")).toEqual(["daniel", "revelation"]);
    expect(keys("2032-2033")).toEqual(["2corinthians", "1thessalonians", "2thessalonians", "1timothy", "2timothy"]);
    expect(years["2033-2034"]).toEqual([{ bookKey: "genesis", start: 1, end: 33 }]);
    expect(keys("2035-2036")).toEqual(["acts", "titus", "philemon", "jude"]);
  });
});

describe("service worker", () => {
  it("embeds a version that changes with the app files and lists the shell", async () => {
    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const { buildServiceWorker, slimChapter } = await import("../scripts/build-data.mjs");
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pbe-sw-"));
    await fs.mkdir(path.join(root, "assets", "js"), { recursive: true });
    await fs.writeFile(path.join(root, "index.html"), "<html></html>");
    await fs.writeFile(path.join(root, "assets", "js", "main.js"), "one");
    const template = 'const VERSION = "__VERSION__";\nconst SHELL = __SHELL__;';

    const first = await buildServiceWorker(root, template);
    expect(first).toContain("assets/js/main.js");
    expect(first).toContain("index.html");
    expect(first).not.toContain("assets/vendor/jszip.min.js");
    expect(await buildServiceWorker(root, template)).toBe(first);

    await fs.writeFile(path.join(root, "assets", "js", "main.js"), "two");
    expect(await buildServiceWorker(root, template)).not.toBe(first);

    expect(slimChapter({ chapter: 1, questions: [{ id: "a", originalIds: ["a"], createdOn: "x", updatedOn: "y", answer: "z" }] }))
      .toEqual({ chapter: 1, questions: [{ id: "a", answer: "z" }] });
  });
});
