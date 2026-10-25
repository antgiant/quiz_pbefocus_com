// People's own questions, read from a filled-in spreadsheet. Pure (no DOM, no storage):
// the spreadsheet reader hands over rows of text, and this turns them into questions.
//
// Only the question, the answer and the points are required. A book, chapter and verse are
// optional, so a question may have no reference at all.

import { hashString } from "./blank-engine.js";

export const CUSTOM_COLUMNS = ["Book", "Chapter", "Verse(s)", "Points", "Question", "Answer"];
export const MAX_CUSTOM_QUESTIONS = 5000;
export const MAX_TEXT_LENGTH = 2000;
export const MAX_POINTS = 20;

// Header text people might type (or Excel might autocorrect) for each field
const HEADER_NAMES = {
  book: ["book"],
  chapter: ["chapter", "chapternumber"],
  verse: ["verse", "verses", "verse(s)", "versenumber"],
  points: ["points", "point", "point(s)", "pts", "pt", "pts."],
  question: ["question", "questions"],
  answer: ["answer", "answers"],
};

function clean(value) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function headerKey(cell) {
  const text = clean(cell).toLowerCase().replace(/\s+/g, "");
  return Object.keys(HEADER_NAMES).find((key) => HEADER_NAMES[key].includes(text)) || null;
}

// The first rows may hold a title; the header is the first row that names a Question and an Answer
export function findHeader(rows) {
  for (let index = 0; index < Math.min(rows.length, 20); index += 1) {
    const columns = {};
    (rows[index] || []).forEach((cell, column) => {
      const key = headerKey(cell);
      if (key && !(key in columns)) {
        columns[key] = column;
      }
    });
    if ("question" in columns && "answer" in columns) {
      return { index, columns };
    }
  }
  return null;
}

// Points decide the difficulty, since a spreadsheet has no other measure of it
export function difficultyForPoints(points) {
  return points <= 1 ? "easy" : points === 2 ? "medium" : "hard";
}

function normalizeBookName(value) {
  return clean(value)
    .toLowerCase()
    .replace(/^(first|1st)\b/, "1")
    .replace(/^(second|2nd)\b/, "2")
    .replace(/^(third|3rd)\b/, "3")
    .replace(/[^a-z0-9]/g, "");
}

function bookLookup(manifest) {
  const lookup = new Map();
  for (const book of manifest?.books || []) {
    lookup.set(normalizeBookName(book.name), book);
    lookup.set(normalizeBookName(book.id), book);
    // "41-mark" is also reachable as just "mark"
    lookup.set(normalizeBookName(String(book.id).replace(/^\d+-/, "")), book);
  }
  return lookup;
}

// "5" or "5-7" (any dash); anything else is not a verse reference
export function parseVerseCell(value) {
  const text = clean(value);
  if (!text) {
    return { start: null, end: null };
  }
  const match = /^(\d{1,3})(?:\s*[-–—]\s*(\d{1,3}))?$/.exec(text);
  if (!match) {
    return null;
  }
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : start;
  return start >= 1 && end >= start ? { start, end } : null;
}

function parsePoints(value) {
  const text = clean(value);
  if (!text) {
    return { points: 1, note: "no points given, so it counts for 1" };
  }
  const number = Number(text);
  if (Number.isInteger(number) && number >= 1 && number <= MAX_POINTS) {
    return { points: number };
  }
  return { points: 1, note: `"${text.slice(0, 20)}" isn't a whole number of points from 1 to ${MAX_POINTS}, so it counts for 1` };
}

function questionKey(question) {
  return [question.bookId || "", question.chapter ?? "", question.startVerse ?? "", question.endVerse ?? "", question.question.toLowerCase()].join("|");
}

// `rows` is a grid of text (row 1 first). Returns the questions plus a note for each row that was
// skipped (`skipped: true`) or taken with a fix-up. `manifest` supplies the books for references.
export function rowsToQuestions(rows, { manifest, now = new Date() } = {}) {
  const header = findHeader(rows);
  if (!header) {
    return { questions: [], issues: [], error: "Couldn't find the Question and Answer columns. Use the spreadsheet from this page." };
  }

  const books = bookLookup(manifest);
  const { columns } = header;
  const cell = (row, key) => (key in columns ? clean(row[columns[key]]) : "");
  const questions = [];
  const issues = [];
  const seen = new Map();
  const ids = new Map();
  let overLimit = false;

  for (let index = header.index + 1; index < rows.length; index += 1) {
    const row = rows[index] || [];
    if (!row.some((value) => clean(value))) {
      continue;
    }
    const rowNumber = index + 1;
    const skip = (text) => issues.push({ row: rowNumber, text, skipped: true });
    const note = (text) => issues.push({ row: rowNumber, text, skipped: false });

    const questionText = cell(row, "question");
    const answerText = cell(row, "answer");
    if (!questionText || !answerText) {
      skip(`needs both a question and an answer`);
      continue;
    }
    if (questionText.length > MAX_TEXT_LENGTH || answerText.length > MAX_TEXT_LENGTH) {
      skip(`the question or answer is longer than ${MAX_TEXT_LENGTH} characters`);
      continue;
    }
    if (questions.length >= MAX_CUSTOM_QUESTIONS) {
      overLimit = true;
      break;
    }

    const question = { question: questionText, answer: answerText };

    const bookText = cell(row, "book");
    const chapterText = cell(row, "chapter");
    const verseText = cell(row, "verse");
    if (bookText || chapterText) {
      const book = books.get(normalizeBookName(bookText));
      const chapter = chapterText === "" ? NaN : Number(chapterText);
      const chapterInfo = book?.chapters?.find((item) => item.number === chapter);
      if (!bookText || chapterText === "") {
        note("a book and a chapter go together, so this question has no reference");
      } else if (!book) {
        skip(`"${bookText.slice(0, 30)}" isn't one of the books in this app`);
        continue;
      } else if (!chapterInfo) {
        skip(`${book.name} has no chapter "${chapterText.slice(0, 10)}" here`);
        continue;
      } else {
        const verses = parseVerseCell(verseText);
        if (!verses) {
          skip(`verse "${verseText.slice(0, 20)}" should look like 5 or 5-7`);
          continue;
        }
        const total = Number(chapterInfo.verses) || 0;
        if (verses.start && total && verses.end > total) {
          skip(`${book.name} ${chapter} only has ${total} verses`);
          continue;
        }
        Object.assign(question, {
          bookId: book.id,
          book: book.name,
          chapter,
          ...(verses.start ? { startVerse: verses.start, endVerse: verses.end } : {}),
        });
      }
    } else if (verseText) {
      note("a verse needs a book and a chapter, so this question has no reference");
    }

    const { points, note: pointsNote } = parsePoints(cell(row, "points"));
    if (pointsNote) {
      note(pointsNote);
    }

    const key = questionKey(question);
    if (seen.has(key)) {
      skip(`same question as row ${seen.get(key)}`);
      continue;
    }
    seen.set(key, rowNumber);

    let id = `custom-${hashString(key).toString(36)}`;
    while (ids.has(id) && ids.get(id) !== key) {
      id += "x";
    }
    ids.set(id, key);

    questions.push({
      ...question,
      id,
      custom: true,
      type: "other",
      points,
      difficulty: difficultyForPoints(points),
      createdBy: "You",
      validatedBy: "You",
      addedOn: now.toISOString(),
    });
  }

  if (overLimit) {
    issues.push({ row: null, text: `only the first ${MAX_CUSTOM_QUESTIONS} questions were used`, skipped: true });
  }
  return { questions, issues };
}

// Same questions on file are updated in place (so uploading an edited spreadsheet again does not
// duplicate them); new ones are added.
export function mergeCustomQuestions(existing, incoming) {
  const byId = new Map(existing.map((question) => [question.id, question]));
  let added = 0;
  let updated = 0;
  for (const question of incoming) {
    if (byId.has(question.id)) {
      updated += 1;
      // The original add date stays
      byId.set(question.id, { ...question, addedOn: byId.get(question.id).addedOn || question.addedOn });
    } else {
      added += 1;
      byId.set(question.id, question);
    }
  }
  return { questions: [...byId.values()].slice(0, MAX_CUSTOM_QUESTIONS), added, updated };
}

// A stored question as spreadsheet cells, in CUSTOM_COLUMNS order
export function questionToRow(question) {
  const verse =
    question.startVerse == null
      ? ""
      : question.endVerse && question.endVerse !== question.startVerse
        ? `${question.startVerse}-${question.endVerse}`
        : String(question.startVerse);
  return [question.book || "", question.chapter ?? "", verse, question.points, question.question, question.answer];
}

// A question with no chapter can't be placed by the chapter picker
export function hasChapter(question) {
  return Boolean(question.bookId) && Number.isInteger(question.chapter);
}

export function customSignature(questions) {
  return String(hashString(questions.map((question) => question.id).sort().join(",")));
}

// A short description of the questions, for the pre-filled GitHub issue
export function describeCustomQuestions(questions) {
  const referenced = questions.filter(hasChapter);
  const books = [...new Set(referenced.map((question) => question.book))];
  const lines = [`${questions.length} ${questions.length === 1 ? "question" : "questions"}`];
  if (books.length) {
    lines.push(`Books: ${books.slice(0, 12).join(", ")}${books.length > 12 ? `, and ${books.length - 12} more` : ""}`);
  }
  if (referenced.length < questions.length) {
    lines.push(`${questions.length - referenced.length} without a book and chapter`);
  }
  return lines.join("\n");
}

export function buildShareIssueUrl(repo, questions, fileName) {
  const summary = describeCustomQuestions(questions);
  const params = new URLSearchParams({
    template: "share-questions.yml",
    title: `Shared questions (${questions.length})`,
    labels: "shared-questions",
    summary,
    // Used when the issue form isn't available: a plain issue with the same words
    body: `${summary}\n\nAttach the spreadsheet (${fileName}) by dragging it into this box.`,
  });
  return `https://github.com/${repo}/issues/new?${params}`;
}
