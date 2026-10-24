// Partial-credit grading of typed answers. PBE answers earn points for their key words (names,
// nouns, verbs, numbers), not for filler like "why are you so", so a half-right answer should
// earn a point, and a different word form (make/making) or a spelling slip still counts.
// Pure: no DOM, no storage. Uses the NLP library when it is loaded (see blank-engine.js).
import { contentWords } from "./blank-engine.js";
import { matchesWithSlips } from "./answer-match.js";
import { stemmer } from "../vendor/spelling.js";
import { normalizeText } from "./utils.js";

// A key word the player got right, whatever its form (fear/fearful, makes/made) or spelling slip
function sameWord(typedWord, keyWord, confusing) {
  return typedWord === keyWord || stemmer(typedWord) === stemmer(keyWord) || matchesWithSlips(typedWord, keyWord, confusing);
}

function typedTokens(typed) {
  return normalizeText(typed).split(" ").filter(Boolean);
}

// The answer as parts that each earn a point: "Why are you so fearful? How is it that you have no
// faith?" is two parts. Only used when the parts line up with the points available.
export function answerParts(answer, points) {
  if (points < 2) return null;
  const bySentence = String(answer || "")
    .split(/(?<=[?.!;])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (bySentence.length === points) return bySentence;
  const byList = String(answer || "")
    .split(/\s*,\s*(?:and\s+)?|\s+and\s+/i)
    .map((part) => part.trim())
    .filter(Boolean);
  return byList.length === points ? byList : null;
}

// Share of the key words (of a part, or of the whole answer when there is a single point) that
// must be there to earn its point: two of three, but both of two
const KEY_SHARE = 0.66;

// Returns { awarded, matched, missed } for a typed answer out of `points`
export function gradeWritten(answer, typed, points, confusing = new Set()) {
  const said = typedTokens(typed);
  const isMatched = (key) => said.some((word) => sameWord(word, key, confusing));
  const unique = (words) => [...new Set(words)];

  const keys = unique(contentWords(answer));
  const matched = keys.filter(isMatched);
  const missed = keys.filter((key) => !matched.includes(key));
  if (!keys.length) return { awarded: 0, matched, missed };

  const parts = answerParts(answer, points);
  if (parts) {
    const awarded = parts.filter((part) => {
      const partKeys = unique(contentWords(part));
      return partKeys.length > 0 && partKeys.filter(isMatched).length / partKeys.length >= KEY_SHARE;
    }).length;
    return { awarded, matched, missed };
  }

  const share = matched.length / keys.length;
  if (share === 1) return { awarded: points, matched, missed };
  const awarded = points === 1 ? (share >= KEY_SHARE ? 1 : 0) : Math.round(points * share);
  return { awarded, matched, missed };
}

// For coloring the answer in the verse: "matched" for a key word the player got, "missed" for one
// they didn't, "minor" for the small words in between that earn nothing either way.
// `allCorrect` is for an answer already accepted in full
export function wordClassifier(answer, typed, confusing = new Set(), allCorrect = false) {
  const keys = new Set(contentWords(answer));
  const said = typedTokens(typed);
  return (word) => {
    const bare = normalizeText(word).split(" ").filter(Boolean);
    const key = bare.find((part) => keys.has(part));
    if (!key) return "minor";
    return allCorrect || said.some((spoken) => sameWord(spoken, key, confusing)) ? "matched" : "missed";
  };
}
