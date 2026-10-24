// How long a question takes to read, for starting the answer timer. In PBE the clock doesn't run
// until the question has been read. Calibrated on the 2026 NAD PBE testing broadcast (Isaiah, from
// 2:22 in; 65 English questions of 8+ words, the read-aloud body only): English reading runs at
// 1.93 words/s, and a leave-one-out check of "words / rate" is off by 1.15 s on average with 98%
// within 3 s. Pure: no DOM, no storage.
import { formatInteractivePrompt } from "./question-formatters.js";

export const ENGLISH_WORDS_PER_SECOND = 1.93;

// NAD reads every question in English and then Spanish before "Begin", so from the start of the
// English to the call to begin is 0.83 words/s of English text (28 bilingual questions: off by
// 2.5 s on average, 86% within 5 s)
export const NAD_WORDS_PER_SECOND = 0.83;
// State testing is English only: half as long as NAD's lead-in. That is a little over the bare
// English reading time (1.93 words/s), which leaves room for the moderator's call to begin.
export const STATE_WORDS_PER_SECOND = NAD_WORDS_PER_SECOND * 2;
// Never make the reader wait on a one-liner
const MIN_READ_SECONDS = 2;

export function countWords(text) {
  return (String(text || "").match(/[A-Za-z0-9']+/g) || []).length;
}

// Words the moderator would read: the reference and question (a fill in the blank reads out its
// whole verse, blanks included), not the "(2 Pts.)" label
export function questionWordCount(question) {
  if (question.segments) {
    const verse = question.segments.map((segment) => segment.text ?? segment.word ?? "").join(" ");
    return countWords(`According to ${question.refLabel || ""} fill in the blanks`) + countWords(verse);
  }
  return countWords(formatInteractivePrompt(question).prompt.replace(/^\(\d+ Pts?\.\)\s*/, ""));
}

// Whole seconds before the answer timer starts. `timer.bilingual` marks NAD timing.
export function readingSeconds(question, timer) {
  const rate = timer?.bilingual ? NAD_WORDS_PER_SECOND : STATE_WORDS_PER_SECOND;
  return Math.max(MIN_READ_SECONDS, Math.ceil(questionWordCount(question) / rate));
}
