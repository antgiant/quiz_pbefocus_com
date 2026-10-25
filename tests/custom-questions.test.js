import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import {
  buildShareIssueUrl,
  customSignature,
  describeCustomQuestions,
  difficultyForPoints,
  findHeader,
  mergeCustomQuestions,
  parseVerseCell,
  questionToRow,
  rowsToQuestions,
} from "../assets/js/custom-questions.js";
import { buildWorkbook, readWorkbookRows } from "../assets/js/custom-xlsx.js";

// Loaded the way the page does: the vendored file sets a global
createRequire(import.meta.url)("../assets/vendor/jszip.min.js");
const JSZip = globalThis.JSZip;

const manifest = {
  books: [
    { id: "41-mark", name: "Mark", chapters: [{ number: 0 }, { number: 1, verses: 45 }, { number: 2, verses: 28 }] },
    { id: "62-1-john", name: "1 John", chapters: [{ number: 1, verses: 10 }] },
  ],
};
const HEADER = ["Book", "Chapter", "Verse(s)", "Points", "Question", "Answer"];
const parse = (...rows) => rowsToQuestions([HEADER, ...rows], { manifest });

describe("reading a filled-in sheet", () => {
  it("needs only a question, an answer and points", () => {
    const { questions, issues } = parse(["", "", "", 2, "Who built the ark?", "Noah"]);
    expect(issues).toEqual([]);
    expect(questions).toHaveLength(1);
    expect(questions[0]).toMatchObject({
      custom: true,
      question: "Who built the ark?",
      answer: "Noah",
      points: 2,
      difficulty: "medium",
      type: "other",
    });
    expect(questions[0].bookId).toBeUndefined();
    expect(questions[0].chapter).toBeUndefined();
  });

  it("finds the columns by header, in any order, below a title row", () => {
    const rows = [["My questions"], ["Answer", "Pts", "Question"], ["Noah", "1", "Who built the ark?"]];
    const { questions } = rowsToQuestions(rows, { manifest });
    expect(questions[0]).toMatchObject({ question: "Who built the ark?", answer: "Noah", points: 1 });
  });

  it("explains a sheet without the right columns", () => {
    const result = rowsToQuestions([["Foo", "Bar"], ["a", "b"]], { manifest });
    expect(result.questions).toEqual([]);
    expect(result.error).toMatch(/Question and Answer/);
    expect(findHeader([["x"]])).toBeNull();
  });

  it("adds the reference when book and chapter are given", () => {
    const { questions } = parse(["mark", 1, "5-7", 1, "q", "a"], ["First John", "1", "", 3, "q2", "a2"]);
    expect(questions[0]).toMatchObject({ bookId: "41-mark", book: "Mark", chapter: 1, startVerse: 5, endVerse: 7 });
    expect(questions[1]).toMatchObject({ bookId: "62-1-john", chapter: 1, difficulty: "hard" });
    expect(questions[1].startVerse).toBeUndefined();
  });

  it("skips rows it cannot use and says why, by sheet row number", () => {
    const { questions, issues } = parse(
      ["", "", "", 1, "no answer", ""],
      ["Narnia", 1, "", 1, "q", "a"],
      ["Mark", 9, "", 1, "q", "a"],
      ["Mark", 1, "46", 1, "q", "a"],
      ["Mark", 1, "abc", 1, "q", "a"],
      ["", "", "", 1, "fine", "ok"]
    );
    expect(questions.map((q) => q.question)).toEqual(["fine"]);
    expect(issues.map((i) => i.row)).toEqual([2, 3, 4, 5, 6]);
    expect(issues.every((i) => i.skipped)).toBe(true);
    expect(issues[3].text).toMatch(/only has 45 verses/);
  });

  it("keeps a question with a fix-up note when points or the reference are off", () => {
    const { questions, issues } = parse(
      ["", "", "", "", "no points", "a"],
      ["", "", "", "lots", "bad points", "a"],
      ["Mark", "", "", 1, "book only", "a"],
      ["", "", "5", 1, "verse only", "a"]
    );
    expect(questions).toHaveLength(4);
    expect(questions.map((q) => q.points)).toEqual([1, 1, 1, 1]);
    expect(issues).toHaveLength(4);
    expect(issues.some((i) => i.skipped)).toBe(false);
    expect(questions[2].bookId).toBeUndefined();
  });

  it("ignores blank rows and repeated questions", () => {
    const { questions, issues } = parse([], ["", "", "", "", "", ""], ["", "", "", 1, "Same", "a"], ["", "", "", 1, "same", "b"]);
    expect(questions).toHaveLength(1);
    expect(issues).toEqual([{ row: 5, text: "same question as row 4", skipped: true }]);
  });

  it("gives the same question the same id each time", () => {
    const a = parse(["Mark", 1, 1, 1, "q", "a"]).questions[0];
    const b = parse(["Mark", 1, 1, 1, "q", "different answer"]).questions[0];
    expect(a.id).toBe(b.id);
    expect(a.id).not.toBe(parse(["Mark", 1, 2, 1, "q", "a"]).questions[0].id);
  });
});

describe("small helpers", () => {
  it("reads verse cells", () => {
    expect(parseVerseCell("5")).toEqual({ start: 5, end: 5 });
    expect(parseVerseCell("5 – 7")).toEqual({ start: 5, end: 7 });
    expect(parseVerseCell("")).toEqual({ start: null, end: null });
    expect(parseVerseCell("7-5")).toBeNull();
    expect(parseVerseCell("5,7")).toBeNull();
  });

  it("sets difficulty from points", () => {
    expect([1, 2, 3, 7].map(difficultyForPoints)).toEqual(["easy", "medium", "hard", "hard"]);
  });

  it("updates questions already on file rather than doubling them", () => {
    const [first] = parse(["", "", "", 1, "q", "a"]).questions;
    const merged = mergeCustomQuestions([{ ...first, addedOn: "old" }], [{ ...first, points: 2 }, { ...first, id: "other" }]);
    expect(merged).toMatchObject({ added: 1, updated: 1 });
    expect(merged.questions.find((q) => q.id === first.id)).toMatchObject({ points: 2, addedOn: "old" });
  });

  it("writes a question back as sheet cells", () => {
    const [q] = parse(["Mark", 1, "5-7", 2, "q", "a"]).questions;
    expect(questionToRow(q)).toEqual(["Mark", 1, "5-7", 2, "q", "a"]);
  });

  it("describes the questions and builds a pre-filled issue link", () => {
    const { questions } = parse(["Mark", 1, "", 1, "q", "a"], ["", "", "", 1, "q2", "a"]);
    expect(describeCustomQuestions(questions)).toBe("2 questions\nBooks: Mark\n1 without a book and chapter");
    const url = new URL(buildShareIssueUrl("owner/repo", questions, "mine.xlsx"));
    expect(url.pathname).toBe("/owner/repo/issues/new");
    expect(url.searchParams.get("template")).toBe("share-questions.yml");
    expect(url.searchParams.get("summary")).toContain("2 questions");
    expect(customSignature(questions)).toBe(customSignature([...questions].reverse()));
  });
});

describe("the spreadsheet file", () => {
  it("makes a blank template that reads back as no questions", async () => {
    const bytes = await buildWorkbook(JSZip, { manifest });
    const rows = await readWorkbookRows(JSZip, bytes);
    expect(rows[0]).toEqual(HEADER);
    expect(rowsToQuestions(rows, { manifest })).toMatchObject({ questions: [], issues: [] });
  });

  it("carries the books for a drop-down, and a plain-text verse column", async () => {
    const zip = await JSZip.loadAsync(await buildWorkbook(JSZip, { manifest }));
    expect(await zip.file("xl/worksheets/sheet3.xml").async("string")).toContain("1 John");
    const sheet = await zip.file("xl/worksheets/sheet1.xml").async("string");
    expect(sheet).toContain("Lists!$A$2:$A$3");
    expect(sheet).toMatch(/<col min="3" max="3"[^>]*style="2"/);
  });

  it("round-trips questions, including awkward text", async () => {
    const { questions } = parse(
      ["Mark", 1, "5-7", 2, 'Who said "peace, be still" & <why>?', "Jesus\nin the boat"],
      ["", "", "", 3, "No reference", "Fine"]
    );
    const rows = await readWorkbookRows(JSZip, await buildWorkbook(JSZip, { manifest, questions }));
    const again = rowsToQuestions(rows, { manifest });
    expect(again.issues).toEqual([]);
    expect(again.questions.map(({ addedOn, ...q }) => q)).toEqual(questions.map(({ addedOn, ...q }) => q));
    expect(again.questions[0].answer).toBe("Jesus\nin the boat");
  });

  it("reads shared strings and numbers the way Excel writes them", async () => {
    const zip = new JSZip();
    zip.file(
      "xl/workbook.xml",
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>'
    );
    zip.file(
      "xl/_rels/workbook.xml.rels",
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/></Relationships>'
    );
    zip.file(
      "xl/sharedStrings.xml",
      '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>Question</t></si><si><t>Answer</t></si><si><t>Points</t></si><si><r><t>Who </t></r><r><t>wept?</t></r></si><si><t>Jesus</t></si></sst>'
    );
    zip.file(
      "xl/worksheets/sheet1.xml",
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
        '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="D1" t="s"><v>2</v></c></row>' +
        '<row r="3"><c r="A3" t="s"><v>3</v></c><c r="B3" t="s"><v>4</v></c><c r="D3"><v>2</v></c></row>' +
        "</sheetData></worksheet>"
    );
    const rows = await readWorkbookRows(JSZip, await zip.generateAsync({ type: "uint8array" }));
    const { questions } = rowsToQuestions(rows, { manifest });
    expect(questions).toHaveLength(1);
    expect(questions[0]).toMatchObject({ question: "Who wept?", answer: "Jesus", points: 2 });
  });

  it("rejects files that are not spreadsheets", async () => {
    await expect(readWorkbookRows(JSZip, new TextEncoder().encode("hello"))).rejects.toThrow(/Excel spreadsheet/);
    const empty = await new JSZip().file("a.txt", "x").generateAsync({ type: "uint8array" });
    await expect(readWorkbookRows(JSZip, empty)).rejects.toThrow(/Excel spreadsheet/);
  });
});
