import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../assets/js/constants.js";
import { blankableWordCount, difficultyForPercent } from "../assets/js/blank-engine.js";
import { finalizeFillInBlank, generateQuestions, reblankQuestions } from "../assets/js/quiz-engine.js";

const LONG = "For God so loved the world that He gave His only begotten Son that whoever believes in Him should not perish but have everlasting life";
const verses = Array.from({ length: 12 }, (_, i) => ({
  verse: i + 1,
  text: `${LONG} number ${i + 1}`,
}));

function authored(verse, type = "what", difficulty = "easy") {
  return {
    id: `a-${verse}-${type}`,
    ref: { startVerse: verse, endVerse: verse },
    bookId: "b",
    book: "Book",
    chapter: 1,
    startVerse: verse,
    endVerse: verse,
    question: `According to Book 1:${verse}, q`,
    answer: "a",
    type,
    points: 1,
    difficulty,
    createdBy: "human",
    validatedBy: "human",
  };
}

function service({ questions = [], chapterVerses = verses, intro = false } = {}) {
  return {
    loadChapter: vi.fn(async () => questions),
    loadNkjvChapterWithRetry: vi.fn(async () => chapterVerses),
    bookName: () => "Book",
    hasIntro: () => intro,
  };
}

function run(overrides = {}, dataService = service(), extra = {}) {
  return generateQuestions({
    dataService,
    year: { id: "y" },
    selectedScope: { b: [1] },
    selectedVerses: {},
    chapterWeights: {},
    settings: {
      ...DEFAULT_SETTINGS,
      totalCount: 10,
      perVerse: 1,
      selectedTypes: ["fill_in_blank"],
      ...overrides,
    },
    seed: 42,
    ...extra,
  });
}

describe("generated fill-in-the-blank", () => {
  it("produces questions with blanks, answers and point values", async () => {
    const { questions } = await run();
    expect(questions).toHaveLength(10);
    for (const question of questions) {
      expect(question.type).toBe("fill_in_blank");
      expect(question.segments.filter((s) => s.blank)).toHaveLength(question.points);
      expect(question.answer.split("; ")).toHaveLength(question.points);
      expect(question.question).toMatch(/^According to Book 1:\d+, fill in the blanks?:/);
      expect(question.question).toContain("__________");
    }
  });

  it("assigns each question to the difficulty band its blank share falls in", async () => {
    const { questions } = await run();
    for (const question of questions) {
      const share = (question.points / blankableWordCount(question.verseText)) * 100;
      expect(difficultyForPercent(share)).toBe(question.difficulty);
    }
  });

  it("only makes the selected difficulties", async () => {
    const { questions } = await run({ selectedDifficulties: ["hard"], totalCount: 6 });
    expect(new Set(questions.map((q) => q.difficulty))).toEqual(new Set(["hard"]));
    for (const question of questions) {
      const share = (question.points / blankableWordCount(question.verseText)) * 100;
      expect(share).toBeGreaterThan(40);
      expect(share).toBeLessThanOrEqual(80);
    }
  });

  it("honours difficulty percentages", async () => {
    const { questions } = await run({
      totalCount: 10,
      difficultyWeights: { easy: 50, medium: 30, hard: 20 },
    });
    const counts = (d) => questions.filter((q) => q.difficulty === d).length;
    expect([counts("easy"), counts("medium"), counts("hard")]).toEqual([5, 3, 2]);
  });

  it("is reproducible for a seed and different for another", async () => {
    const a = await run();
    const b = await run();
    const c = await run({}, service(), { seed: 7 });
    expect(a.questions.map((q) => q.question)).toEqual(b.questions.map((q) => q.question));
    expect(a.questions.map((q) => q.question)).not.toEqual(c.questions.map((q) => q.question));
  });

  it("can be overridden with a number of blanks", async () => {
    const { questions } = await run({
      fillInBlank: { mode: "custom", unit: "count", minBlanks: 2, maxBlanks: 2, minPercent: 10, maxPercent: 40 },
    });
    expect(questions.length).toBeGreaterThan(0);
    for (const question of questions) {
      expect(question.points).toBe(2);
    }
  });

  it("can be overridden with a percent of the words, labelling difficulty from the result", async () => {
    const { questions } = await run({
      selectedDifficulties: ["hard"],
      fillInBlank: { mode: "custom", unit: "percent", minPercent: 50, maxPercent: 50, minBlanks: 1, maxBlanks: 3 },
    });
    expect(questions.length).toBeGreaterThan(0);
    for (const question of questions) {
      expect(question.difficulty).toBe("hard");
      expect(question.points).toBe(Math.round(blankableWordCount(question.verseText) / 2));
    }
  });

  it("limits to the selected verses", async () => {
    const { questions } = await run({}, service(), { selectedVerses: { "b:1": [2, 3] } });
    expect(new Set(questions.map((q) => q.startVerse))).toEqual(new Set([2, 3]));
  });

  it("is not removed by the source filter", async () => {
    const { questions } = await run({ selectedSources: ["ai_unreviewed"] });
    expect(questions.length).toBeGreaterThan(0);
  });

  it("respects the per-verse cap across difficulties", async () => {
    const { questions } = await run({ perVerse: 1, totalCount: 40 });
    const perVerse = new Map();
    for (const q of questions) perVerse.set(q.startVerse, (perVerse.get(q.startVerse) || 0) + 1);
    expect(Math.max(...perVerse.values())).toBe(1);
    expect(questions).toHaveLength(12);
  });

  it("reports chapters whose verses could not be downloaded", async () => {
    const { questions, unmet } = await run({}, service({ chapterVerses: [] }));
    expect(questions).toEqual([]);
    expect(unmet.join(" ")).toMatch(/Couldn't download verses for Book 1/);
  });

  it("reports download progress", async () => {
    const onProgress = vi.fn();
    await run({}, service(), { selectedScope: { b: [1, 2] }, onProgress });
    expect(onProgress).toHaveBeenLastCalledWith({ done: 2, total: 2 });
  });

  it("labels intro passages", async () => {
    const intro = [{ verse: 1, text: "<strong>Title.</strong> Ruth was a Moabitish woman who lived long ago.", label: "Title" }];
    const { questions } = await run(
      { totalCount: 1, selectedDifficulties: ["medium", "hard", "easy"] },
      service({ chapterVerses: intro }),
      { selectedScope: { b: [0] } }
    );
    expect(questions[0].question).toMatch(/^According to Book Intro: Title, fill in/);
  });

  it("re-blanks the same verses with new words", async () => {
    const first = await run({ totalCount: 8 });
    const again = reblankQuestions(first.questions, first.fibContext, 999);
    expect(again.map((q) => q.id)).toEqual(first.questions.map((q) => q.id));
    expect(again.map((q) => q.answer)).not.toEqual(first.questions.map((q) => q.answer));
  });

  it("leaves written questions untouched when finalizing", () => {
    const question = authored(1);
    expect(finalizeFillInBlank([question], {}, 1)[0]).toBe(question);
  });
});

describe("mixing with written questions", () => {
  const written = Array.from({ length: 12 }, (_, i) => authored(i + 1, "what", "medium"));

  it("mixes written and generated questions", async () => {
    const { questions } = await run(
      { selectedTypes: ["short_answer", "fill_in_blank"], totalCount: 12, perVerse: 2 },
      service({ questions: written })
    );
    expect(questions.some((q) => q.generated)).toBe(true);
    expect(questions.some((q) => !q.generated)).toBe(true);
  });

  it("honours a question type mix", async () => {
    const { questions } = await run(
      {
        selectedTypes: ["short_answer", "fill_in_blank"],
        typeWeights: { short_answer: 75, fill_in_blank: 25 },
        totalCount: 8,
        perVerse: 2,
      },
      service({ questions: written })
    );
    expect(questions.filter((q) => q.generated)).toHaveLength(2);
    expect(questions.filter((q) => !q.generated)).toHaveLength(6);
  });

  it("fills in from another type when one runs out", async () => {
    const { questions, unmet } = await run(
      {
        selectedTypes: ["short_answer", "fill_in_blank"],
        typeWeights: { short_answer: 100, fill_in_blank: 0 },
        totalCount: 20,
        perVerse: 1,
      },
      service({ questions: written })
    );
    expect(questions).toHaveLength(12);
    expect(unmet.join(" ")).toMatch(/Requested 20/);
  });

  it("keeps generated questions from crowding out written ones by default", async () => {
    // 12 verses x 3 difficulties = 36 generated candidates against 12 written ones
    const { questions } = await run(
      { selectedTypes: ["short_answer", "fill_in_blank"], totalCount: 12, perVerse: 3 },
      service({ questions: written })
    );
    const generated = questions.filter((q) => q.generated).length;
    expect(generated).toBeGreaterThan(0);
    expect(generated).toBeLessThanOrEqual(8);
  });

  it("does not generate fill-in-the-blank unless that type is selected", async () => {
    const dataService = service({ questions: written });
    const { questions } = await run({ selectedTypes: ["short_answer"] }, dataService);
    expect(questions.every((q) => !q.generated)).toBe(true);
    expect(dataService.loadNkjvChapterWithRetry).not.toHaveBeenCalled();
  });
});
