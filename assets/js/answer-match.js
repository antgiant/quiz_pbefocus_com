// Forgiving answer matching. Real PBE sessions don't mark an answer wrong for a spelling slip,
// unless the slip makes it a different answer (typing "Judas" for "Jude" is a different person).
// Spelling is judged by two libraries instead of hand-made rules: Double Metaphone (do the two
// words sound the same?) and Jaro-Winkler (how close are the letters?), vendored in
// assets/vendor/spelling.js. Pure: no DOM, no storage.
import { doubleMetaphone, jaroWinkler } from "../vendor/spelling.js";
import { normalizeText } from "./utils.js";

// How alike two spellings must be. Judah/Jude sound the same but score 0.85, so they stay apart;
// Phillip/Philip, repnet/repent and Caperneum/Capernaum score 0.95 or more.
const SIMILARITY = 0.88;
// Short words differ by one letter all the time (Paul/Saul, Mary/Mark), so they must be exact
const MIN_FORGIVEN_LENGTH = 4;

function soundsAlike(a, b) {
  const [primaryA, secondaryA] = doubleMetaphone(a);
  const codesB = new Set(doubleMetaphone(b));
  return [primaryA, secondaryA].some((code) => code && codesB.has(code));
}

// `others` holds words that would be a different answer (normalized). A typed word that is one of
// them is never forgiven, however close it is to the expected word.
function wordMatches(typed, expected, others) {
  if (typed === expected) return true;
  if (others.has(typed) || expected.length < MIN_FORGIVEN_LENGTH) return false;
  return jaroWinkler(typed, expected) >= SIMILARITY && soundsAlike(typed, expected);
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
