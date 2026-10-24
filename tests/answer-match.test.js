import { describe, expect, it } from "vitest";
import { confusableWords, matchesWithSlips } from "../assets/js/answer-match.js";
import { gradeBlanks } from "../assets/js/renderers.js";

describe("matchesWithSlips", () => {
  it("forgives a slip in a longer word", () => {
    expect(matchesWithSlips("Phillip", "Philip")).toBe(true);
    expect(matchesWithSlips("repnet", "repent")).toBe(true);
    expect(matchesWithSlips("Capernaum", "Capernaum")).toBe(true);
    expect(matchesWithSlips("Caperneum", "Capernaum")).toBe(true);
  });

  it("keeps names that only sound alike apart", () => {
    expect(matchesWithSlips("Judah", "Jude")).toBe(false);
    expect(matchesWithSlips("Judas", "Jude")).toBe(false);
    expect(matchesWithSlips("Elisha", "Elijah")).toBe(false);
    expect(matchesWithSlips("baptizer", "baptist")).toBe(false);
  });

  it("accepts common misspellings of biblical names", () => {
    for (const [typed, expected] of [
      ["Jeruslem", "Jerusalem"],
      ["Mathew", "Matthew"],
      ["Pharasee", "Pharisee"],
      ["Isaac", "Issac"],
      ["Nazereth", "Nazareth"],
      ["Bartholemew", "Bartholomew"],
    ]) {
      expect(matchesWithSlips(typed, expected), `${typed} for ${expected}`).toBe(true);
    }
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
