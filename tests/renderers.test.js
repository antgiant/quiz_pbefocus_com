import { beforeEach, describe, expect, it } from "vitest";
import {
  createPrintSheets,
  blankHint,
  countedBlanks,
  gradeBlanks,
  interactiveHintsUsed,
  renderInteractive,
  renderPeopleList,
  renderTypeCheckboxes,
} from "../assets/js/renderers.js";
import { formatFillInBlankLead, formatVerseRef } from "../assets/js/question-formatters.js";
import { launchConfetti } from "../assets/js/confetti.js";

const fib = (overrides = {}) => ({
  id: "fib-1",
  type: "fill_in_blank",
  generated: true,
  book: "Mark",
  chapter: 1,
  startVerse: 5,
  endVerse: 5,
  points: 2,
  difficulty: "easy",
  question: "x",
  answer: "gospel; Son",
  blankWords: ["gospel", "Son"],
  segments: [
    { text: "The " },
    { blank: true, word: "gospel" },
    { text: " of the " },
    { blank: true, word: "Son" },
    { text: " of God." },
  ],
  ...overrides,
});

const result = (overrides = {}) => ({
  input: "",
  status: "unanswered",
  autoCorrect: false,
  awarded: 0,
  remainingMs: null,
  expired: false,
  ...overrides,
});

let container;
beforeEach(() => {
  document.body.innerHTML = "";
  container = document.createElement("div");
  document.body.append(container);
});

describe("formatters", () => {
  it("uses a custom reference label (intros)", () => {
    expect(formatVerseRef({ refLabel: "Ruth Intro: Title" })).toBe("Ruth Intro: Title");
    expect(formatVerseRef({ book: "Mark", chapter: 1, startVerse: 2, endVerse: 4 })).toBe("Mark 1:2-4");
  });

  it("words the lead for one or many blanks", () => {
    expect(formatFillInBlankLead(fib({ points: 1 }))).toBe("According to Mark 1:5, fill in the blank:");
    expect(formatFillInBlankLead(fib())).toBe("According to Mark 1:5, fill in the blanks:");
  });
});

describe("people list", () => {
  const people = [
    { id: "a", name: "Ann" },
    { id: "b", name: "Bob" },
    { id: "c", name: "Cy" },
  ];

  it("renders a row per person with the active one selected", () => {
    renderPeopleList(container, people, "b", ["a", "b"]);
    const rows = [...container.querySelectorAll(".person-row")];
    expect(rows.map((row) => row.dataset.id)).toEqual(["a", "b", "c"]);
    expect(rows[1].classList.contains("is-active")).toBe(true);
    expect(rows.every((row) => row.draggable)).toBe(true);
    expect(container.querySelector('input[name="activePerson"]:checked').value).toBe("b");
    expect([...container.querySelectorAll('[data-role="person-print"]')].map((box) => box.checked)).toEqual([
      true,
      true,
      false,
    ]);
  });

  it("disables moving past either end and labels the buttons for screen readers", () => {
    renderPeopleList(container, people, "a", []);
    const rows = container.querySelectorAll(".person-row");
    expect(rows[0].querySelector('[data-role="move-up"]').disabled).toBe(true);
    expect(rows[2].querySelector('[data-role="move-down"]').disabled).toBe(true);
    expect(rows[1].querySelector('[data-role="move-up"]').getAttribute("aria-label")).toBe("Move Bob up");
  });

  it("shows names as text, never markup", () => {
    renderPeopleList(container, [{ id: "a", name: "<img src=x onerror=alert(1)>" }], "a", []);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector(".person-name").textContent).toBe("<img src=x onerror=alert(1)>");
  });
});

describe("type chips", () => {
  it("adds a percent box for each type that is on only when checked", () => {
    renderTypeCheckboxes(container, ["short_answer", "fill_in_blank"], ["fill_in_blank"], { fill_in_blank: 40 });
    const boxes = container.querySelectorAll('[data-role="type-weight"]');
    expect([...boxes].map((box) => box.disabled)).toEqual([true, false]);
    expect(boxes[1].value).toBe("40");
  });
});

describe("grading blanks", () => {
  it("ignores case and punctuation and treats empty as wrong", () => {
    expect(gradeBlanks(fib(), ["  GOSPEL! ", ""])).toEqual([true, false]);
    expect(gradeBlanks(fib(), ["gospel", "son"])).toEqual([true, true]);
    expect(gradeBlanks(fib(), [])).toEqual([false, false]);
  });
});

describe("default score", () => {
  it("does not count blanks that a hint filled in", () => {
    expect(countedBlanks([true, true, false], [1])).toEqual([true, false, false]);
    expect(countedBlanks([true, true])).toEqual([true, true]);
    expect(countedBlanks([true, true], [0, 1])).toEqual([false, false]);
  });
});

describe("print sheets", () => {
  it("prints ruled lines on the quiz and the words, marked, on the key", () => {
    const template = document.createElement("template");
    template.innerHTML = `<section class="print-sheet"><span class="print-meta"></span><span class="print-scope"></span><ol class="print-questions"></ol></section>
      <section class="print-sheet answer-sheet"><span class="print-meta"></span><span class="print-scope"></span><ol class="print-answers"></ol></section>`;
    const sheets = createPrintSheets(template, [
      {
        person: { name: "Ann" },
        questions: [fib(), { question: "Who?", answer: "Jesus" }],
        settingsLabel: "Year",
        scopeLabel: "Scope",
      },
    ]);
    container.append(sheets);

    const first = container.querySelector(".print-questions li");
    expect(first.querySelectorAll(".print-blank")).toHaveLength(2);
    expect(first.textContent).toContain("According to Mark 1:5, fill in the blanks:");
    expect(first.textContent).not.toContain("gospel");

    const key = container.querySelector(".print-answers li");
    expect([...key.querySelectorAll(".print-answer-word")].map((word) => word.textContent)).toEqual(["gospel", "Son"]);
    expect(container.querySelectorAll(".print-questions li")[1].textContent).toBe("Who?");
    expect(container.querySelectorAll(".print-answers li")[1].textContent).toBe("Jesus");
  });
});

describe("interactive fill in the blank", () => {
  const state = (resultOverrides = {}, options = {}) => ({
    questions: [fib()],
    index: 0,
    options,
    complete: false,
    results: [result(resultOverrides)],
  });

  it("shows an underscore to tap per blank", () => {
    renderInteractive(container, state());
    expect(container.querySelectorAll(".fib-blank")).toHaveLength(2);
    expect(container.querySelector(".fib-blank").textContent).toBe("_____");
    expect(container.querySelectorAll(".fib-input")).toHaveLength(0);
    expect(container.querySelector(".fib-lead").textContent).toBe("According to Mark 1:5, fill in the blanks: (2 Pts.)");
    expect(container.querySelector("#interactiveFibVerse").textContent).not.toContain("gospel");
  });

  it("opens a box for tapped blanks and leaves the rest as underscores", () => {
    renderInteractive(container, state({ opened: [1] }));
    expect(container.querySelectorAll(".fib-blank")).toHaveLength(1);
    const boxes = container.querySelectorAll(".fib-input");
    expect(boxes).toHaveLength(1);
    expect(boxes[0].dataset.index).toBe("1");
    expect(boxes[0].readOnly).toBe(false);
  });

  it("shows a first-letter hint in a tapped blank that still takes typing", () => {
    expect(blankHint("gospel")).toBe("g _ _ _ _ _");
    renderInteractive(container, state({ inputs: ["", ""], opened: [0], peeked: [0], hinted: [0] }));
    const box = container.querySelector(".fib-input");
    expect(box.placeholder).toBe("g _ _ _ _ _");
    expect(box.readOnly).toBe(false);
    expect(box.classList.contains("is-hinted")).toBe(true);
  });

  it("offers a ? on open blanks until the whole word is shown", () => {
    renderInteractive(container, state({ inputs: ["", ""], opened: [0, 1], peeked: [0], hinted: [0] }));
    expect(container.querySelectorAll(".fib-help")).toHaveLength(2);
    renderInteractive(container, state({ inputs: ["gospel", ""], opened: [0], hinted: [0] }));
    expect(container.querySelector(".fib-help")).toBeNull();
  });

  it("puts a fully hinted word in the box even if no text was stored", () => {
    renderInteractive(container, state({ inputs: ["", ""], opened: [0], hinted: [0] }));
    const box = container.querySelector(".fib-input");
    expect(box.value).toBe("gospel");
    expect(box.readOnly).toBe(true);
    expect(box.classList.contains("is-revealed")).toBe(true);
  });

  it("uses one main button that checks, then moves on", () => {
    renderInteractive(container, state());
    expect(container.querySelector("#interactiveNextBtn")).toBeNull();
    expect(container.querySelector("#interactiveSubmitBtn").textContent).toBe("Submit");
    renderInteractive(container, state({ status: "submitted", inputs: ["gospel", "Son"], hinted: [], blankCorrect: [true, true] }));
    expect(container.querySelector("#interactiveSubmitBtn").textContent).toBe("Finish");
    const two = state();
    two.questions = [fib(), fib({ id: "fib-2" })];
    two.results = [result({ status: "submitted", inputs: ["", ""], hinted: [], blankCorrect: [false, false] }), result()];
    renderInteractive(container, two);
    expect(container.querySelector("#interactiveSubmitBtn").textContent).toBe("Next");
  });

  it("locks hinted blanks and counts hints", () => {
    const s = state({ inputs: ["gospel", ""], hinted: [0] });
    renderInteractive(container, s);
    const boxes = container.querySelectorAll(".fib-input");
    expect(boxes).toHaveLength(1);
    expect(boxes[0].readOnly).toBe(true);
    expect(boxes[0].value).toBe("gospel");
    expect(container.querySelectorAll(".fib-blank")).toHaveLength(1);
    expect(interactiveHintsUsed(s)).toBe(1);
  });

  it("counts hinted blanks as incorrect and notes the hints on the answer page", () => {
    renderInteractive(
      container,
      state({
        status: "submitted",
        inputs: ["gospel", "wrong"],
        hinted: [0],
        blankCorrect: [true, false],
        awarded: 0,
      })
    );
    const panel = container.querySelector("#interactiveAnswerPanel");
    expect(panel.hidden).toBe(false);
    expect(panel.textContent).toContain("0 of 2 blanks correct.");
    expect(panel.textContent).toContain("Hints used: 1");
    // The hinted word is listed plainly (lightbulb marker via CSS); the note explains it
    const hintedItem = panel.querySelector(".fib-results .is-hinted");
    expect(hintedItem.textContent).toBe("gospel");
    expect(panel.textContent).not.toContain("(hint, counts as incorrect)");
    expect(panel.textContent).toContain("Blanks filled by a hint count as incorrect");
    expect(panel.textContent).toContain("wrong → Son");
    expect(panel.querySelectorAll(".answer-words")).toHaveLength(2);
    // The hinted blank is not marked as a right or wrong answer; the typed one is
    const boxes = container.querySelectorAll(".fib-input");
    expect(boxes[0].classList.contains("is-correct")).toBe(false);
    expect(boxes[0].getAttribute("aria-label")).toContain("hint used, counts as incorrect");
    expect(boxes[1].classList.contains("is-incorrect")).toBe(true);
    expect(container.querySelector('input[name="interactivePoints"]:checked').value).toBe("0");
  });

  it("sizes every box to the longest answer so nothing is cut off", () => {
    const long = fib({
      blankWords: ["Philadelphia", "Son"],
      segments: [{ blank: true, word: "Philadelphia" }, { text: " and " }, { blank: true, word: "Son" }],
    });
    renderInteractive(container, {
      questions: [long],
      index: 0,
      options: {},
      complete: false,
      results: [result()],
    });
    // Unopened blanks are plain links of the same text, so length is no clue either
    expect([...container.querySelectorAll(".fib-blank")].map((blank) => blank.textContent)).toEqual(["_____", "_____"]);
    renderInteractive(container, { questions: [long], index: 0, options: {}, complete: false, results: [result({ opened: [0, 1] })] });
    expect([...container.querySelectorAll(".fib-input")].map((box) => box.style.width)).toEqual(["15ch", "15ch"]);
    renderInteractive(container, state({ opened: [0, 1] }));
    expect([...container.querySelectorAll(".fib-input")].map((box) => box.style.width)).toEqual(["9ch", "9ch"]);
  });

  it("leaves out the hints note when none were used", () => {
    renderInteractive(
      container,
      state({ status: "submitted", inputs: ["gospel", "Son"], hinted: [], blankCorrect: [true, true], awarded: 2 })
    );
    expect(container.querySelector(".interactive-hints-note").hidden).toBe(true);
  });

  it("locks everything in realistic mode once time is up", () => {
    renderInteractive(container, state({ expired: true, remainingMs: 0 }, { realistic: true, timer: { first: 10, additional: 5 } }));
    expect([...container.querySelectorAll(".fib-input")].every((box) => box.readOnly)).toBe(true);
    expect(container.querySelector(".fib-help")).toBeNull();
  });

  it("offers practice again with the hints total when finished", () => {
    const s = state({ status: "submitted", hinted: [0, 1], inputs: ["gospel", "Son"], blankCorrect: [true, true], awarded: 2 });
    s.complete = true;
    renderInteractive(container, s);
    expect(container.querySelector("#interactivePracticeAgainBtn")).not.toBeNull();
    expect(container.textContent).toContain("Hints used: 2");
  });

  it("does not offer practice again for written questions only", () => {
    renderInteractive(container, {
      questions: [{ question: "Q?", answer: "A", type: "what", points: 1 }],
      index: 0,
      options: {},
      complete: true,
      results: [result({ status: "submitted" })],
    });
    expect(container.querySelector("#interactivePracticeAgainBtn")).toBeNull();
  });

  it("still renders written questions with a single answer box", () => {
    renderInteractive(container, {
      questions: [{ question: "According to Mark 1:1, who?", answer: "Jesus", type: "who", points: 1, book: "Mark", chapter: 1, startVerse: 1, endVerse: 1 }],
      index: 0,
      options: {},
      complete: false,
      results: [result()],
    });
    expect(container.querySelector("#interactiveAnswerInput")).not.toBeNull();
    expect(container.querySelector(".fib-input")).toBeNull();
    expect(container.querySelector(".fib-help")).toBeNull();
  });
});

describe("confetti", () => {
  it("adds pieces and skips them when motion is reduced", () => {
    window.matchMedia = () => ({ matches: false });
    expect(launchConfetti(5, container)).toBe(5);
    expect(container.querySelectorAll(".confetti")).toHaveLength(5);
    window.matchMedia = () => ({ matches: true });
    expect(launchConfetti(5, container)).toBe(0);
  });
});
