import { describe, expect, it } from "vitest";
import fixture from "./fixtures/nad-2026-reading.json";
import {
  ENGLISH_WORDS_PER_SECOND,
  NAD_WORDS_PER_SECOND,
  STATE_WORDS_PER_SECOND,
  countWords,
  questionWordCount,
  readingSeconds,
} from "../assets/js/reading-time.js";

const meanAbsError = (rows, rate) =>
  rows.reduce((sum, [words, seconds]) => sum + Math.abs(words / rate - seconds), 0) / rows.length;
const within = (rows, rate, tolerance) =>
  rows.filter(([words, seconds]) => Math.abs(words / rate - seconds) <= tolerance).length / rows.length;

describe("reading speed, checked against the 2026 NAD testing broadcast", () => {
  it("estimates English reading time within a couple of seconds", () => {
    expect(fixture.english.length).toBeGreaterThanOrEqual(60);
    expect(meanAbsError(fixture.english, ENGLISH_WORDS_PER_SECOND)).toBeLessThan(1.5);
    expect(within(fixture.english, ENGLISH_WORDS_PER_SECOND, 3)).toBeGreaterThan(0.95);
  });

  it("estimates NAD's English-and-Spanish lead-in to the call to begin", () => {
    expect(meanAbsError(fixture.bilingual, NAD_WORDS_PER_SECOND)).toBeLessThan(3);
    expect(within(fixture.bilingual, NAD_WORDS_PER_SECOND, 5)).toBeGreaterThan(0.8);
  });

  it("makes state testing half as long as NAD", () => {
    expect(STATE_WORDS_PER_SECOND).toBeCloseTo(NAD_WORDS_PER_SECOND * 2);
  });
});

describe("readingSeconds", () => {
  const question = {
    book: "Mark",
    chapter: 4,
    startVerse: 40,
    endVerse: 40,
    points: 2,
    question: "According to Mark 4:40, what two questions did Jesus ask His disciples?",
  };

  it("counts what is read aloud, not the points label", () => {
    expect(questionWordCount(question)).toBe(countWords("According to Mark 4:40 what two questions did Jesus ask His disciples"));
  });

  it("gives NAD twice the state lead-in", () => {
    const state = readingSeconds(question, { first: 10, additional: 5 });
    const nad = readingSeconds(question, { first: 30, additional: 10, bilingual: true });
    expect(nad).toBeGreaterThanOrEqual(state * 2 - 1);
    expect(nad).toBeLessThanOrEqual(state * 2 + 1);
  });

  it("reads a fill in the blank's whole verse", () => {
    const fib = {
      refLabel: "Mark 4:6",
      segments: [{ text: "But when the sun was up it was scorched, and it " }, { blank: true, word: "withered" }, { text: " away." }],
    };
    expect(questionWordCount(fib)).toBeGreaterThan(14);
  });

  it("never waits less than two seconds", () => {
    expect(readingSeconds({ ...question, question: "Who?" }, {})).toBeGreaterThanOrEqual(2);
  });
});
