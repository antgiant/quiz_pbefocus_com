import { describe, expect, it } from "vitest";
import {
  BLANK_BANDS,
  analysisSize,
  analyzeVerse,
  blankCountRange,
  buildBlankedVerse,
  buildTfidfContext,
  clearAnalysis,
  difficultyForPercent,
  exportAnalysis,
  hasAnalysis,
  importAnalysis,
  makeRng,
  normalizeTextForNlp,
  pickBandBlankCount,
  pickCustomBlankCount,
  segmentsToAnswerText,
  segmentsToText,
  validateCustomBlanks,
  wordCountOf,
  blankableWordCount,
  isIgnoredWord,
} from "../assets/js/blank-engine.js";

const VERSE =
  "For God so loved the world that He gave His only begotten Son, that whoever believes in Him should not perish but have everlasting life.";

describe("difficulty bands", () => {
  it("maps percent of words to a difficulty", () => {
    expect(difficultyForPercent(5)).toBe("easy");
    expect(difficultyForPercent(20)).toBe("easy");
    expect(difficultyForPercent(20.1)).toBe("medium");
    expect(difficultyForPercent(40)).toBe("medium");
    expect(difficultyForPercent(40.1)).toBe("hard");
    expect(difficultyForPercent(80)).toBe("hard");
  });

  it("finds whole-word counts inside each band", () => {
    // 10 words: easy 1-2, medium 3-4, hard 5-8
    expect(blankCountRange(10, "easy")).toEqual({ min: 1, max: 2 });
    expect(blankCountRange(10, "medium")).toEqual({ min: 3, max: 4 });
    expect(blankCountRange(10, "hard")).toEqual({ min: 5, max: 8 });
  });

  it("treats band edges as >lo and <=hi", () => {
    // 5 words: 1 = 20% (easy), 2 = 40% (medium), 3 = 60% (hard)
    expect(blankCountRange(5, "easy")).toEqual({ min: 1, max: 1 });
    expect(blankCountRange(5, "medium")).toEqual({ min: 2, max: 2 });
    expect(blankCountRange(5, "hard")).toEqual({ min: 3, max: 4 });
  });

  it("returns null when a verse is too short for a band", () => {
    expect(blankCountRange(4, "easy")).toBeNull();
    expect(blankCountRange(0, "easy")).toBeNull();
    expect(blankCountRange(2, "medium")).toBeNull();
    expect(blankCountRange(3, "medium")).toEqual({ min: 1, max: 1 });
  });

  it("always yields a count that maps back to the requested difficulty", () => {
    const rng = makeRng(7);
    for (const difficulty of Object.keys(BLANK_BANDS)) {
      for (let words = 5; words <= 60; words += 1) {
        const range = blankCountRange(words, difficulty);
        if (!range) continue;
        for (let i = 0; i < 10; i += 1) {
          const count = pickBandBlankCount(words, difficulty, rng);
          expect(difficultyForPercent((count / words) * 100)).toBe(difficulty);
        }
      }
    }
  });

  it("varies the count within a band", () => {
    const rng = makeRng(3);
    const counts = new Set(Array.from({ length: 80 }, () => pickBandBlankCount(40, "hard", rng)));
    expect(counts.size).toBeGreaterThan(5);
  });
});

describe("custom override", () => {
  it("picks a count between min and max blanks", () => {
    const rng = makeRng(1);
    for (let i = 0; i < 50; i += 1) {
      const count = pickCustomBlankCount(20, { unit: "count", minBlanks: 2, maxBlanks: 4 }, rng);
      expect(count).toBeGreaterThanOrEqual(2);
      expect(count).toBeLessThanOrEqual(4);
    }
  });

  it("never exceeds the words in the verse", () => {
    const rng = makeRng(1);
    expect(pickCustomBlankCount(3, { unit: "count", minBlanks: 5, maxBlanks: 9 }, rng)).toBe(3);
  });

  it("converts a percent range to a word count", () => {
    const rng = makeRng(2);
    for (let i = 0; i < 50; i += 1) {
      const count = pickCustomBlankCount(20, { unit: "percent", minPercent: 25, maxPercent: 50 }, rng);
      expect(count).toBeGreaterThanOrEqual(5);
      expect(count).toBeLessThanOrEqual(10);
    }
  });

  it("validates ranges", () => {
    expect(validateCustomBlanks({ unit: "count", minBlanks: 1, maxBlanks: 3 })).toEqual({});
    expect(validateCustomBlanks({ unit: "count", minBlanks: 0, maxBlanks: 3 }).min).toBeTruthy();
    expect(validateCustomBlanks({ unit: "count", minBlanks: 4, maxBlanks: 3 }).max).toBeTruthy();
    expect(validateCustomBlanks({ unit: "percent", minPercent: 10, maxPercent: 120 }).max).toBeTruthy();
    expect(validateCustomBlanks({ unit: "percent", minPercent: 30, maxPercent: 20 }).max).toBeTruthy();
  });
});

describe("buildBlankedVerse", () => {
  it("blanks the requested number of words and keeps the rest", () => {
    const { segments, words } = buildBlankedVerse({ text: VERSE, count: 3, rng: makeRng(5) });
    expect(words).toHaveLength(3);
    expect(segmentsToAnswerText(segments)).toBe(VERSE);
    expect(segmentsToText(segments)).not.toContain(words[0] + " ");
    expect(segments.filter((segment) => segment.blank)).toHaveLength(3);
  });

  it("is deterministic for a seed and varies across seeds", () => {
    const run = (seed) => buildBlankedVerse({ text: VERSE, count: 3, rng: makeRng(seed) }).words.join("|");
    expect(run(11)).toBe(run(11));
    const variants = new Set(Array.from({ length: 30 }, (_, seed) => run(seed)));
    expect(variants.size).toBeGreaterThan(1);
  });

  it("prefers meaningful words over function words", () => {
    const { words } = buildBlankedVerse({ text: VERSE, count: 2, rng: makeRng(9) });
    for (const word of words) {
      expect(["for", "the", "that", "in", "not", "but", "his", "should", "have"]).not.toContain(
        word.toLowerCase()
      );
    }
  });

  it("blanks one occurrence of a repeated word and keeps the others", () => {
    const text = "Lord Lord Lord Lord Lord";
    const { segments, words } = buildBlankedVerse({ text, count: 2, rng: makeRng(4) });
    expect(words).toEqual(["Lord", "Lord"]);
    expect(segmentsToAnswerText(segments)).toBe(text);
  });

  it("never blanks more words than the verse has", () => {
    const { words } = buildBlankedVerse({ text: "Jesus wept.", count: 10, rng: makeRng(1) });
    expect(words.length).toBeLessThanOrEqual(2);
  });

  it("strips markup and entities before blanking", () => {
    const { segments } = buildBlankedVerse({
      text: "In the <i>beginning</i> God created the heavens &amp; the earth.",
      count: 1,
      rng: makeRng(2),
    });
    const text = segmentsToAnswerText(segments);
    expect(text).toBe("In the beginning God created the heavens & the earth.");
  });

  it("returns nothing for empty text", () => {
    expect(buildBlankedVerse({ text: "  ", count: 2 })).toEqual({ segments: [], words: [] });
  });

  it("works without the NLP library", () => {
    const saved = globalThis.nlp;
    globalThis.nlp = undefined;
    try {
      const { words } = buildBlankedVerse({ text: VERSE, count: 2, rng: makeRng(2) });
      expect(words).toHaveLength(2);
    } finally {
      globalThis.nlp = saved;
    }
  });

  it("uses TF-IDF scores to favour distinctive words", () => {
    const verses = [
      { id: "a", chapterKey: "c1", text: "The Lord is my shepherd I shall not want" },
      { id: "b", chapterKey: "c1", text: "The Lord is my light and my salvation" },
      { id: "c", chapterKey: "c1", text: "The Lord is the strength of my life" },
    ];
    const context = buildTfidfContext(verses);
    expect(Object.keys(context.verseLevel)).toEqual(["a", "b", "c"]);
    expect(context.chapterLevel.c1).toBeTruthy();
    const { words } = buildBlankedVerse({
      text: verses[0].text,
      count: 1,
      scores: { verse: context.verseLevel.a, chapter: context.chapterLevel.c1 },
      rng: makeRng(1),
    });
    expect(words).toHaveLength(1);
  });
});

describe("normalizeTextForNlp", () => {
  it("lowercases the word after punctuation unless it is a known name", () => {
    expect(normalizeTextForNlp("He said, And then Moses spoke; The end")).toBe(
      "He said, and then Moses spoke; the end"
    );
  });

  it("handles every punctuation mark, not just the first occurrence", () => {
    expect(normalizeTextForNlp("a, B, C, B")).toBe("a, b, c, b");
  });

  it("keeps names that carry trailing punctuation", () => {
    expect(normalizeTextForNlp("then, Jacob, Esau")).toBe("then, Jacob, esau");
  });
});

describe("ignored small words", () => {
  const text = "For God so loved the world that he gave his only begotten Son";

  it("leaves them out of the word count", () => {
    expect(wordCountOf(text)).toBe(13);
    // God, loved, world, gave, only, begotten, Son
    expect(blankableWordCount(text)).toBe(7);
    expect(isIgnoredWord("The")).toBe(true);
    expect(isIgnoredWord("is,")).toBe(true);
    expect(isIgnoredWord("Jesus")).toBe(false);
  });

  it("never blanks them, even when asked for more blanks than the verse has", () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const { words } = buildBlankedVerse({ text, count: 13, rng: makeRng(seed) });
      expect(words.length).toBeLessThanOrEqual(7);
      expect(words.filter(isIgnoredWord)).toEqual([]);
    }
  });

  it("never blanks them without the NLP library either", () => {
    const saved = globalThis.nlp;
    globalThis.nlp = undefined;
    try {
      const { words } = buildBlankedVerse({ text, count: 13, rng: makeRng(3) });
      expect(words.filter(isIgnoredWord)).toEqual([]);
      expect(words.length).toBeGreaterThan(0);
    } finally {
      globalThis.nlp = saved;
    }
  });
});

describe("helpers", () => {
  it("counts words after stripping markup", () => {
    expect(wordCountOf("<b>One</b> two  three")).toBe(3);
    expect(wordCountOf("")).toBe(0);
  });
});

describe("term analysis cache", () => {
  const verseText = "In the beginning God created the heaven and the earth.";

  it("blanks the same words from a cached analysis without the NLP library", () => {
    clearAnalysis();
    const first = buildBlankedVerse({ text: verseText, count: 3, rng: makeRng(7) });
    expect(hasAnalysis(verseText)).toBe(true);

    const saved = globalThis.nlp;
    globalThis.nlp = undefined;
    try {
      const second = buildBlankedVerse({ text: verseText, count: 3, rng: makeRng(7) });
      expect(second).toEqual(first);
    } finally {
      globalThis.nlp = saved;
    }
  });

  it("does not keep a verse tagged without the NLP library", () => {
    clearAnalysis();
    const saved = globalThis.nlp;
    globalThis.nlp = undefined;
    try {
      buildBlankedVerse({ text: verseText, count: 2, rng: makeRng(1) });
      expect(hasAnalysis(verseText)).toBe(false);
      expect(analyzeVerse(verseText)).toBe(false);
    } finally {
      globalThis.nlp = saved;
    }
  });

  it("round-trips through export and import", () => {
    clearAnalysis();
    expect(analyzeVerse(verseText)).toBe(true);
    const saved = exportAnalysis();

    clearAnalysis();
    expect(analysisSize()).toBe(0);
    importAnalysis(saved);
    importAnalysis([["bad"], null, "x"]);

    expect(analysisSize()).toBe(1);
    expect(hasAnalysis(verseText)).toBe(true);
  });
});

describe("tf-idf context", () => {
  const verses = [
    { id: "b:1:1", chapterKey: "b:1", text: "The Lord is my shepherd" },
    { id: "b:1:2", chapterKey: "b:1", text: "He makes me lie down in green pastures" },
  ];

  it("reuses the result for the same pool and scores verses on first read", () => {
    const context = buildTfidfContext(verses);

    expect(buildTfidfContext(verses)).toBe(context);
    expect(Object.keys(context.verseLevel)).toEqual(["b:1:1", "b:1:2"]);
    const scores = context.verseLevel["b:1:1"];
    expect(Math.max(...Object.values(scores))).toBe(1);
    expect(context.verseLevel["b:1:1"]).toBe(scores);
  });

  it("builds a new result when the pool changes", () => {
    const context = buildTfidfContext(verses);
    expect(buildTfidfContext(verses.slice(0, 1))).not.toBe(context);
  });
});
