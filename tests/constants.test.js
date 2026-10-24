import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, QUIZ_STYLES, quizStyleForTypes } from "../assets/js/constants.js";

describe("quiz styles", () => {
  it("defaults to the mixed style", () => {
    expect(QUIZ_STYLES[0].id).toBe("mixed");
    expect(quizStyleForTypes(DEFAULT_SETTINGS.selectedTypes)).toBe("mixed");
  });

  it("recognises single-type styles and calls anything else custom", () => {
    expect(quizStyleForTypes(["fill_in_blank"])).toBe("fill_in_blank");
    expect(quizStyleForTypes(["short_answer"])).toBe("short_answer");
    expect(quizStyleForTypes(["short_answer", "true_false"])).toBe("custom");
    expect(quizStyleForTypes([])).toBe("custom");
  });
});
