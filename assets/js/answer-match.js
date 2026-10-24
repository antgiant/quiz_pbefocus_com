// Forgiving answer matching. Real PBE sessions don't mark an answer wrong for a spelling slip,
// unless the slip makes it a different answer (typing "Judas" for "Jude" is a different person).
// Pure: no DOM, no storage.
import { normalizeText } from "./utils.js";

// Edit distance where swapping two neighbouring letters counts as one slip
export function editDistance(a, b) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const table = Array.from({ length: rows }, (_, i) => [i, ...Array(cols - 1).fill(0)]);
  for (let j = 0; j < cols; j += 1) table[0][j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      table[i][j] = Math.min(table[i - 1][j] + 1, table[i][j - 1] + 1, table[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        table[i][j] = Math.min(table[i][j], table[i - 2][j - 2] + 1);
      }
    }
  }
  return table[rows - 1][cols - 1];
}

// Short words differ by one letter all the time (Paul/Saul, Mary/Mark), so they must be exact
export function allowedSlips(word) {
  if (word.length >= 9) return 2;
  if (word.length >= 5) return 1;
  return 0;
}

// `others` holds words that would be a different answer (normalized). A typed word that is
// one of them is never forgiven, however close it is to the expected word.
function wordMatches(typed, expected, others) {
  if (typed === expected) return true;
  if (others.has(typed)) return false;
  return editDistance(typed, expected) <= allowedSlips(expected);
}

// Whether `typedText` counts as `expectedText`: the same words, each allowed a spelling slip
export function matchesWithSlips(typedText, expectedText, others = new Set()) {
  const typed = normalizeText(typedText).split(" ").filter(Boolean);
  const expected = normalizeText(expectedText).split(" ").filter(Boolean);
  if (!typed.length || typed.length !== expected.length) return false;
  return expected.every((word, i) => wordMatches(typed[i], word, others));
}

// Words from other texts that the player could have meant instead, minus the expected answer's own
export function confusableWords(texts, expectedText) {
  const own = new Set(normalizeText(expectedText).split(" "));
  const words = new Set();
  for (const text of texts) {
    for (const word of normalizeText(text).split(" ")) {
      if (word && !own.has(word)) words.add(word);
    }
  }
  return words;
}
