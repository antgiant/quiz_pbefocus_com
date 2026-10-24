import { describe, expect, it } from "vitest";
import { allowedSlips, confusableWords, editDistance, matchesWithSlips } from "../assets/js/answer-match.js";
import { gradeBlanks } from "../assets/js/renderers.js";

describe("editDistance", () => {
  it("counts insertions, deletions, substitutions and swapped neighbours", () => {
    expect(editDistance("philip", "phillip")).toBe(1);
    expect(editDistance("repent", "repnet")).toBe(1);
    expect(editDistance("jude", "judas")).toBe(2);
    expect(editDistance("same", "same")).toBe(0);
  });
});

describe("matchesWithSlips", () => {
  it("forgives a slip in a longer word", () => {
    expect(allowedSlips("Philippians".toLowerCase())).toBe(2);
    expect(matchesWithSlips("Phillip", "Philip")).toBe(true);
    expect(matchesWithSlips("repnet", "repent")).toBe(true);
    expect(matchesWithSlips("Capernaum", "Capernaum")).toBe(true);
    expect(matchesWithSlips("Caperneum", "Capernaum")).toBe(true);
  });

  it("holds short words to an exact match", () => {
    expect(matchesWithSlips("Saul", "Paul")).toBe(false);
    expect(matchesWithSlips("Mark", "Mary")).toBe(false);
  });

  it("does not forgive a slip that is a different answer", () => {
    const others = confusableWords(["Was it Philip or Phillip?"], "Philip");
    expect(others.has("phillip")).toBe(true);
    expect(matchesWithSlips("Phillip", "Philip", others)).toBe(false);
  });

  it("needs the same number of words", () => {
    expect(matchesWithSlips("john the baptist", "john the baptizer")).toBe(false);
    expect(matchesWithSlips("john the baptiste", "john the baptist")).toBe(true);
    expect(matchesWithSlips("john", "john the baptist")).toBe(false);
  });

  it("ignores case and punctuation", () => {
    expect(matchesWithSlips("  PHILLIP! ", "philip")).toBe(true);
  });
});

describe("gradeBlanks with slips", () => {
  const question = {
    blankWords: ["Capernaum", "Jude"],
    segments: [
      { blank: true, word: "Capernaum" },
      { text: " and Judas and " },
      { blank: true, word: "Jude" },
    ],
  };

  it("accepts a misspelled blank", () => {
    expect(gradeBlanks(question, ["Caperneum", "Jude"])).toEqual([true, true]);
  });

  it("still marks a different word wrong", () => {
    expect(gradeBlanks(question, ["Capernaum", "Judas"])).toEqual([true, false]);
  });
});
