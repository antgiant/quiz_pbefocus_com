export function formatVerseRef(question) {
  if (question.refLabel) {
    return question.refLabel;
  }
  const suffix =
    question.endVerse && question.endVerse !== question.startVerse
      ? `-${question.endVerse}`
      : "";
  return `${question.book} ${question.chapter}:${question.startVerse}${suffix}`;
}

// "According to Mark 1:5, fill in the blanks:" - the text before a blanked verse
export function formatFillInBlankLead(question) {
  const blanks = Math.max(1, Number(question.points) || 1);
  return `According to ${formatVerseRef(question)}, fill in the ${blanks === 1 ? "blank" : "blanks"}:`;
}

export function formatQuestionLabel(question) {
  const points = Number(question.points) || 1;
  const pointWord = points === 1 ? "Pt." : "Pts.";
  return `(${points} ${pointWord}) ${question.question}`;
}

export function formatInteractivePrompt(question) {
  const ref = formatVerseRef(question);
  const points = Number(question.points) || 1;
  const pointWord = points === 1 ? "Pt." : "Pts.";
  const prefix = `(${points} ${pointWord}) According to ${ref}`;
  const rawQuestion = safeQuestionText(question.question);
  const questionWithoutLead = rawQuestion.replace(
    new RegExp(`^According to ${escapeRegExp(ref)},?\\s*`, "i"),
    ""
  );

  return {
    prompt: `${prefix}\n${questionWithoutLead}`,
  };
}

export function formatInteractiveAnswer(question) {
  return {
    answer: `Answer: ${question.answer}`,
    reference: formatVerseRef(question),
  };
}

function safeQuestionText(value) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Bible API text can carry inline markup such as <i>…</i> and HTML entities
export function cleanVerseText(text) {
  return String(text || "")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

// Full verse text as runs; the first case-insensitive match of the answer is flagged
export function verseRuns(verses, answer) {
  const text = verses.map((v) => `${v.verse} ${cleanVerseText(v.text)}`).join(" ");
  const needle = String(answer || "").trim();
  const index = needle ? text.toLowerCase().indexOf(needle.toLowerCase()) : -1;
  if (index < 0) {
    return [{ text, isAnswer: false }];
  }
  return [
    { text: text.slice(0, index), isAnswer: false },
    { text: text.slice(index, index + needle.length), isAnswer: true },
    { text: text.slice(index + needle.length), isAnswer: false },
  ].filter((run) => run.text);
}

// Seconds allowed for a question: time for the first point plus extra time per additional point
export function secondsForQuestion(question, timer) {
  const points = Math.max(1, Number(question.points) || 1);
  return Math.max(1, timer.first + (points - 1) * timer.additional);
}
