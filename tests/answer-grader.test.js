import { describe, expect, it } from "vitest";
import { answerParts, gradeWritten, wordClassifier } from "../assets/js/answer-grader.js";
import { contentWords } from "../assets/js/blank-engine.js";

describe("contentWords", () => {
  it("keeps names, nouns, verbs and describing words", () => {
    expect(contentWords("Why are you so fearful? How is it that you have no faith?")).toEqual(["fearful", "faith"]);
    expect(contentWords("Why make this commotion and weep")).toEqual(["make", "commotion", "weep"]);
    expect(contentWords("five loaves and two fish")).toEqual(["five", "loaves", "two", "fish"]);
  });
});

describe("answerParts", () => {
  it("splits an answer into one part per point", () => {
    expect(answerParts("Why are you so fearful? How is it that you have no faith?", 2)).toEqual([
      "Why are you so fearful?",
      "How is it that you have no faith?",
    ]);
    expect(answerParts("Peter, James and John", 3)).toEqual(["Peter", "James", "John"]);
  });

  it("does not split when the parts don't match the points", () => {
    expect(answerParts("Peter, James and John", 2)).toBeNull();
    expect(answerParts("Jesus", 1)).toBeNull();
  });
});

describe("gradeWritten", () => {
  const answer = "Why are you so fearful? How is it that you have no faith?";

  it("earns the point for the part that was answered", () => {
    expect(gradeWritten(answer, "Why are you so fearful? Hope is it that yo", 2).awarded).toBe(1);
  });

  it("earns every point for the whole answer", () => {
    expect(gradeWritten(answer, "why are you so fearful how is it that you have no faith", 2).awarded).toBe(2);
  });

  it("earns nothing for an unrelated answer", () => {
    expect(gradeWritten(answer, "because of the storm", 2).awarded).toBe(0);
  });

  it("gives partial credit by key words when the answer is not split by point", () => {
    const result = gradeWritten("Why make this commotion and weep", "Why make this commission and weep", 2);
    expect(result.awarded).toBe(1);
    expect(result.matched).toEqual(["make", "weep"]);
    expect(result.missed).toEqual(["commotion"]);
  });

  it("accepts other forms of a word and spelling slips", () => {
    expect(gradeWritten("Jesus fed the five thousand", "Jesus feeds five thousands", 1).awarded).toBe(1);
    expect(gradeWritten("Capernaum", "Caperneum", 1).awarded).toBe(1);
  });

  it("needs most of the key words for a single point", () => {
    expect(gradeWritten("Peter and John", "Peter", 1).awarded).toBe(0);
    expect(gradeWritten("the Lord Jesus Christ", "Jesus Christ", 1).awarded).toBe(1);
  });

  it("does not forgive a slip that is a different answer", () => {
    expect(gradeWritten("Jude", "Judah", 1, new Set(["judah"])).awarded).toBe(0);
  });
});

describe("wordClassifier", () => {
  it("marks key words as matched or missed and filler as minor", () => {
    const classify = wordClassifier("Why make this commotion and weep", "make and weep");
    expect(["Why", "make", "this", "commotion", "and", "weep"].map(classify)).toEqual([
      "minor",
      "matched",
      "minor",
      "missed",
      "minor",
      "matched",
    ]);
  });

  it("marks every key word matched for an answer accepted in full", () => {
    const classify = wordClassifier("Why make this commotion", "anything", new Set(), true);
    expect(classify("commotion")).toBe("matched");
  });
});
