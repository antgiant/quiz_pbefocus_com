import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../assets/js/constants.js";
import { generateQuestions } from "../assets/js/quiz-engine.js";
import { CustomStore } from "../assets/js/custom-store.js";
import { DataService } from "../assets/js/data-service.js";
import { formatInteractivePrompt, formatVerseRef, hasVerseText } from "../assets/js/question-formatters.js";

const written = (verse) => ({
  id: `w-${verse}`, bookId: "b", book: "Book", chapter: 1, startVerse: verse, endVerse: verse,
  question: "written", answer: "a", type: "what", points: 1, difficulty: "easy", createdBy: "human", validatedBy: "human",
});
const own = (id, extra = {}) => ({
  id, custom: true, question: `own ${id}`, answer: "a", type: "other", points: 1, difficulty: "easy",
  createdBy: "You", validatedBy: "You", ...extra,
});

function service(loose = []) {
  return {
    loadChapter: vi.fn(async () => [written(1), written(2), own("c1", { bookId: "b", book: "Book", chapter: 1 })]),
    loadNkjvChapterWithRetry: vi.fn(async () => []),
    bookName: () => "Book",
    hasIntro: () => false,
    looseCustomQuestions: () => loose,
  };
}

const run = (overrides, svc, scope = { b: [1] }) =>
  generateQuestions({
    dataService: svc, year: { id: "y" }, selectedScope: scope, selectedVerses: {}, chapterWeights: {},
    settings: { ...DEFAULT_SETTINGS, totalCount: 10, perVerse: 1, selectedTypes: ["short_answer"], ...overrides },
    seed: 1,
  });

describe("own questions in a quiz", () => {
  it("mixes them in by default, with or without a chapter", async () => {
    const { questions } = await run({}, service([own("l1"), own("l2")]));
    expect(questions.map((q) => q.id).sort()).toEqual(["c1", "l1", "l2", "w-1", "w-2"]);
  });

  it("does not cap questions without a verse by the per-verse limit", async () => {
    const { questions } = await run({ ownQuestions: "only" }, service([own("l1"), own("l2"), own("l3")]));
    expect(questions).toHaveLength(4);
  });

  it("uses only their own, whatever the type selection", async () => {
    const { questions } = await run({ ownQuestions: "only", selectedTypes: ["fill_in_blank"] }, service([own("l1")]));
    expect(questions.every((q) => q.custom)).toBe(true);
    expect(questions).toHaveLength(2);
  });

  it("can leave them out", async () => {
    const { questions } = await run({ ownQuestions: "exclude" }, service([own("l1")]));
    expect(questions.map((q) => q.id).sort()).toEqual(["w-1", "w-2"]);
  });

  it("serves unreferenced ones even when no chapter is selected, but only in 'only' mode", async () => {
    const svc = service([own("l1")]);
    expect((await run({ ownQuestions: "only" }, svc, {})).questions.map((q) => q.id)).toEqual(["l1"]);
    expect((await run({}, svc, {})).questions).toEqual([]);
  });

  it("lets unreferenced ones fill in when chapter percentages are set", async () => {
    const { questions } = await run({}, service([own("l1")]), { b: [1] }).then((r) => r);
    const weighted = await generateQuestions({
      dataService: service([own("l1")]), year: { id: "y" }, selectedScope: { b: [1] }, selectedVerses: {},
      chapterWeights: { "b:1": 100 }, settings: { ...DEFAULT_SETTINGS, totalCount: 10, perVerse: 1, selectedTypes: ["short_answer"] }, seed: 1,
    });
    expect(questions).toHaveLength(4);
    expect(weighted.questions.map((q) => q.id)).toContain("l1");
  });

  it("keeps a chapter-wide question when specific verses are chosen", async () => {
    const result = await generateQuestions({
      dataService: service(), year: { id: "y" }, selectedScope: { b: [1] }, selectedVerses: { "b:1": [1] }, chapterWeights: {},
      settings: { ...DEFAULT_SETTINGS, totalCount: 10, perVerse: 1, selectedTypes: ["short_answer"] }, seed: 1,
    });
    expect(result.questions.map((q) => q.id).sort()).toEqual(["c1", "w-1"]);
  });
});

describe("questions without a reference", () => {
  it("print no reference and have no verse text", () => {
    const q = own("x");
    expect(formatVerseRef(q)).toBe("");
    expect(hasVerseText(q)).toBe(false);
    expect(formatInteractivePrompt(q).prompt).toBe("(1 Pt.) own x");
    expect(formatVerseRef(own("y", { book: "Mark", chapter: 1 }))).toBe("Mark 1");
  });
});

describe("saving them", () => {
  it("keeps questions between visits", async () => {
    const store = new CustomStore();
    expect(await store.get()).toEqual([]);
    expect(await store.set([own("a")])).toBe(true);
    expect(await new CustomStore().get()).toEqual([own("a")]);
  });

  it("reports when nothing can be saved", async () => {
    expect(await new CustomStore(null).set([own("a")])).toBe(false);
  });

  it("adds them to their chapter in the data service", async () => {
    const data = new DataService();
    data.setCustomQuestions([own("a", { bookId: "b", chapter: 1 }), own("b")]);
    data.loadWrittenChapter = async () => [written(1)];
    expect((await data.loadChapter("b", 1)).map((q) => q.id)).toEqual(["w-1", "a"]);
    expect((await data.loadChapter("b", 2)).length).toBe(1);
    expect(data.looseCustomQuestions().map((q) => q.id)).toEqual(["b"]);
  });
});
