// Fill-in-the-blank generation, ported from the PBE study tool.
// Pure functions only (no DOM, no storage) so every output - preview, print,
// PowerPoint and the interactive quiz - can share the exact same blanks.
// Word choice uses the `compromise` NLP library (global `nlp`) when it is
// loaded and falls back to plain whitespace tokens when it is not.

import { cleanVerseText } from "./question-formatters.js";

// --- Difficulty <-> percent of words blanked ---
// easy: up to 20%, medium: over 20% up to 40%, hard: over 40% up to 80%.
// `lo` is exclusive and `hi` inclusive.
export const BLANK_BANDS = {
  easy: { lo: 0, hi: 20 },
  medium: { lo: 20, hi: 40 },
  hard: { lo: 40, hi: 80 },
};

export const BLANK_PLACEHOLDER = "__________";

export function difficultyForPercent(percent) {
  if (percent <= BLANK_BANDS.easy.hi) return "easy";
  if (percent <= BLANK_BANDS.medium.hi) return "medium";
  return "hard";
}

const STATE_OF_BEING_WORDS = ["am", "is", "are", "was", "were", "be", "being", "been"];

// Small connecting words are ignored completely: they are never blanked and they don't
// count towards the share of a verse that is blanked.
export const IGNORED_WORDS = new Set([
  "and", "or", "but", "nor", "yet", "so", "for",
  "the", "a", "an",
  "in", "on", "at", "to", "from", "by", "with", "about", "against", "between", "into", "through",
  "during", "before", "after", "above", "below", "up", "down", "of", "off", "over", "under", "upon",
  "i", "you", "he", "she", "it", "we", "they", "me", "him", "her", "us", "them", "my", "your", "his",
  "their", "our",
  "this", "that", "these", "those",
  ...STATE_OF_BEING_WORDS,
  "will", "would", "shall", "should", "can", "could", "may", "might", "must", "do", "does", "did",
  "have", "has", "had",
  "as", "if", "then", "than", "when", "while", "who", "whom", "whose", "which", "what", "there", "here",
  "also", "its", "unto", "thee", "thou", "thy", "thine", "ye", "hath", "doth",
]);

export function isIgnoredWord(word) {
  return IGNORED_WORDS.has(String(word || "").replace(/[^\w']/g, "").toLowerCase());
}

export function wordCountOf(text) {
  const plain = cleanVerseText(text);
  return plain ? plain.split(/\s+/).filter(Boolean).length : 0;
}

// The words of a verse that can be blanked: everything except the ignored small words.
// This is what blank shares and counts are measured against.
export function blankableWordCount(text) {
  const plain = cleanVerseText(text);
  return plain ? plain.split(/\s+/).filter((word) => word && !isIgnoredWord(word)).length : 0;
}

// Whole-word blank counts whose share of the verse falls inside the difficulty
// band, or null when the verse is too short to have one (e.g. 4 words, easy).
export function blankCountRange(wordCount, difficulty) {
  const band = BLANK_BANDS[difficulty];
  if (!band || wordCount < 1) return null;
  const min = Math.floor((band.lo * wordCount) / 100 + 1e-9) + 1;
  const max = Math.min(wordCount, Math.floor((band.hi * wordCount) / 100 + 1e-9));
  return min <= max ? { min, max } : null;
}

// A random percent inside the band, rounded to whole words and kept inside it
export function pickBandBlankCount(wordCount, difficulty, rng) {
  const range = blankCountRange(wordCount, difficulty);
  if (!range) return null;
  const band = BLANK_BANDS[difficulty];
  const percent = band.lo + rng() * (band.hi - band.lo);
  const count = Math.round((percent * wordCount) / 100);
  return Math.max(range.min, Math.min(range.max, count));
}

// Manual override: either a number of blanks or a percent of the words
export function pickCustomBlankCount(wordCount, custom, rng) {
  if (wordCount < 1) return null;
  const clamp = (n) => Math.max(1, Math.min(wordCount, n));

  if (custom.unit === "percent") {
    const lo = Math.min(custom.minPercent, custom.maxPercent);
    const hi = Math.max(custom.minPercent, custom.maxPercent);
    const percent = lo + rng() * (hi - lo);
    return clamp(Math.round((percent * wordCount) / 100));
  }

  const lo = clamp(Math.min(custom.minBlanks, custom.maxBlanks));
  const hi = clamp(Math.max(custom.minBlanks, custom.maxBlanks));
  return lo + Math.floor(rng() * (hi - lo + 1));
}

export function validateCustomBlanks(custom) {
  const errors = {};
  if (custom.unit === "percent") {
    if (!(custom.minPercent >= 1 && custom.minPercent <= 100)) {
      errors.min = "Minimum percent must be between 1 and 100.";
    }
    if (!(custom.maxPercent >= 1 && custom.maxPercent <= 100)) {
      errors.max = "Maximum percent must be between 1 and 100.";
    } else if (custom.maxPercent < custom.minPercent) {
      errors.max = "Maximum percent must be at least the minimum.";
    }
  } else {
    if (!(custom.minBlanks >= 1)) {
      errors.min = "Minimum blanks must be at least 1.";
    }
    if (!(custom.maxBlanks >= 1)) {
      errors.max = "Maximum blanks must be at least 1.";
    } else if (custom.maxBlanks < custom.minBlanks) {
      errors.max = "Maximum blanks must be at least the minimum.";
    }
  }
  return errors;
}

// --- Seeded randomness ---

export function makeRng(seed) {
  let a = (Number(seed) || 1) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function shuffleWith(array, rng) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// --- TF-IDF ---

export const TFIDF_CONFIG = {
  verseWeight: 0.6,
  chapterWeight: 0.4,
  tfidfWeight: 0.3,
  priorityWeight: 0.7,
  minWordLength: 2,
  // Seeded noise on each word's score so a verse blanks differently each time
  // while still favouring higher-priority words (priority levels are 0.14 apart)
  jitter: 0.2,
};

export function tokenizeText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= TFIDF_CONFIG.minWordLength);
}

function termFrequency(words) {
  const frequency = {};
  for (const word of words) {
    frequency[word] = (frequency[word] || 0) + 1;
  }
  for (const word of Object.keys(frequency)) {
    frequency[word] /= words.length;
  }
  return frequency;
}

function combineTfIdf(tf, idf) {
  const scores = {};
  for (const word of Object.keys(tf)) {
    scores[word] = tf[word] * (idf[word] || 0);
  }
  return scores;
}

export function normalizeScores(scores) {
  const values = Object.values(scores);
  if (values.length === 0) return {};
  const min = Math.min(...values);
  const range = Math.max(...values) - min;
  const normalized = {};
  for (const [key, value] of Object.entries(scores)) {
    normalized[key] = range === 0 ? 1 : (value - min) / range;
  }
  return normalized;
}

function inverseDocumentFrequency(termSets) {
  const documentFrequency = {};
  for (const words of termSets) {
    for (const word of new Set(words)) {
      documentFrequency[word] = (documentFrequency[word] || 0) + 1;
    }
  }
  const idf = {};
  for (const [word, count] of Object.entries(documentFrequency)) {
    idf[word] = Math.log(termSets.length / count);
  }
  return idf;
}

// Scores how distinctive each word is within each verse and within each
// chapter of the pool being studied. `verses` is [{ id, chapterKey, text }].
// The same pool is scored again whenever settings change, so the last result is reused
let lastTfidf = { signature: null, context: null };

function poolSignature(verses) {
  return verses.map((verse) => `${verse.id}#${verse.text.length}`).join(",");
}

// Defines obj[key] as a value worked out the first time it is read
function lazyProperty(obj, key, compute) {
  Object.defineProperty(obj, key, {
    enumerable: true,
    configurable: true,
    get() {
      const value = compute();
      Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true });
      return value;
    },
  });
}

export function buildTfidfContext(verses) {
  const verseLevel = {};
  const chapterLevel = {};
  if (!verses.length) return { verseLevel, chapterLevel };

  const signature = poolSignature(verses);
  if (lastTfidf.signature === signature) return lastTfidf.context;
  const context = { verseLevel, chapterLevel };
  lastTfidf = { signature, context };

  const tokenized = verses.map((verse) => {
    const words = tokenizeText(cleanVerseText(verse.text));
    return { ...verse, words, unique: [...new Set(words)] };
  });

  // Only the verses that get blanked are ever read, so the document frequencies are
  // worked out up front but each verse's and chapter's scores on first read
  const verseIdf = inverseDocumentFrequency(tokenized.map((verse) => verse.unique));
  for (const verse of tokenized) {
    lazyProperty(verseLevel, verse.id, () => normalizeScores(combineTfIdf(termFrequency(verse.words), verseIdf)));
  }

  const chapters = new Map();
  for (const verse of tokenized) {
    if (!chapters.has(verse.chapterKey)) chapters.set(verse.chapterKey, []);
    chapters.get(verse.chapterKey).push(...verse.unique);
  }
  const chapterIdf = inverseDocumentFrequency([...chapters.values()].map((words) => [...new Set(words)]));
  for (const [key, words] of chapters) {
    lazyProperty(chapterLevel, key, () => normalizeScores(combineTfIdf(termFrequency(words), chapterIdf)));
  }

  return context;
}

// --- Word priority ---

// Biblical names and key terms: highest priority, and never lowercased for the tagger
const PRIORITY_WORDS = new Set([
  "lord", "god", "jesus", "christ", "messiah", "savior", "redeemer", "spirit", "father", "holy", "almighty", "yahweh", "jehovah",
  "adam", "eve", "noah", "abraham", "sarah", "isaac", "rebekah", "jacob", "rachel", "leah", "joseph",
  "moses", "aaron", "miriam", "pharaoh", "joshua", "caleb",
  "gideon", "samson", "deborah", "samuel", "eli",
  "saul", "david", "solomon", "elijah", "elisha", "isaiah", "jeremiah", "ezekiel", "daniel",
  "hosea", "joel", "amos", "obadiah", "jonah", "micah", "nahum", "habakkuk", "zephaniah", "haggai", "zechariah", "malachi",
  "mary", "john", "peter", "paul", "matthew", "mark", "luke", "james", "andrew", "philip", "bartholomew", "thomas", "judas", "simon", "thaddaeus",
  "stephen", "barnabas", "timothy", "titus", "silas", "apollos", "priscilla", "aquila",
  "pilate", "herod", "caesar", "caiaphas",
  "israel", "jerusalem", "zion", "bethlehem", "nazareth", "galilee", "judea", "samaria", "egypt", "babylon", "assyria",
  "canaan", "jordan", "sinai", "horeb", "carmel", "olivet", "gethsemane", "calvary", "golgotha",
  "eden", "babel", "sodom", "gomorrah", "jericho", "damascus", "nineveh", "tarsus", "corinth", "ephesus", "rome", "macedonia", "athens",
  "israelites", "hebrews", "jews", "gentiles", "pharisees", "sadducees", "levites", "priests", "disciples", "apostles",
  "philistines", "egyptians", "babylonians", "assyrians", "romans", "persians", "medes",
]);

function bareWord(word) {
  return word.replace(/[^\w']/g, "").toLowerCase();
}

// The tagger mistakes capitalised sentence starts for names, so lowercase the
// first word after punctuation unless it is a known name.
export function normalizeTextForNlp(text) {
  return text.replace(/([.!?,;:]\s+)(\S)/g, (match, lead, firstChar, offset) => {
    const word = text.slice(offset + lead.length).match(/^\S+/)?.[0] || firstChar;
    return PRIORITY_WORDS.has(bareWord(word)) ? match : lead + firstChar.toLowerCase();
  });
}

const pluginInstalled = new WeakSet();

function getNlp() {
  const nlp = globalThis.nlp;
  if (typeof nlp !== "function") return null;
  if (!pluginInstalled.has(nlp)) {
    nlp.plugin(() => ({
      tags: { StatesofBeingVerbs: { isA: null } },
      words: Object.fromEntries(STATE_OF_BEING_WORDS.map((word) => [word, "StatesofBeingVerbs"])),
    }));
    pluginInstalled.add(nlp);
  }
  return nlp;
}

function hasTag(term, tags) {
  return term.tags?.some((tag) => tags.includes(tag));
}

// --- Term analysis cache ---
// Tagging a verse is the slow part of blanking and always gives the same answer
// for the same text, so results are kept (and can be saved between visits).
// A term is [text, priority]; priority 0 marks punctuation. Results made without
// the NLP library are not kept, so they never replace real ones.
const analysisCache = new Map();

export function hasAnalysis(text) {
  return analysisCache.has(cleanVerseText(text));
}

export function analysisSize() {
  return analysisCache.size;
}

export function exportAnalysis() {
  return [...analysisCache];
}

export function importAnalysis(entries) {
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (Array.isArray(entry) && typeof entry[0] === "string" && Array.isArray(entry[1])) {
      analysisCache.set(entry[0], entry[1]);
    }
  }
}

export function clearAnalysis() {
  analysisCache.clear();
}

// Tags a verse now (needs the NLP library) so later blanking of it is instant;
// returns false when the library is not loaded
export function analyzeVerse(text) {
  const plain = cleanVerseText(text);
  if (!plain || analysisCache.has(plain)) return true;
  return Boolean(analyzeTerms(plain, true));
}

function analyzeTerms(plainText, store = false) {
  const cached = analysisCache.get(plainText);
  if (cached) return cached;

  const nlp = getNlp();
  const normalized = normalizeTextForNlp(plainText);
  const terms = nlp
    ? nlp(normalized)
        .json({ terms: true })
        .flatMap((sentence) => sentence.terms || [])
    : plainText.split(/\s+/).map((word) => ({ text: word, tags: [] }));

  const analyzed = terms.map((term) => [term.text || "", termPriority(term)]);
  if (nlp) {
    analysisCache.set(plainText, analyzed);
    return analyzed;
  }
  return store ? null : analyzed;
}

function termPriority(term) {
  if (hasTag(term, ["Punctuation"])) return 0;

  const lower = (term.text || "").toLowerCase();
  if (IGNORED_WORDS.has(lower)) return 4;
  if (
    PRIORITY_WORDS.has(lower) ||
    hasTag(term, ["Person", "Place", "Organization", "Date", "Value", "Cardinal", "Ordinal"])
  ) {
    return 1;
  }
  if (hasTag(term, ["Noun", "Verb", "Gerund"])) return 2;
  if (hasTag(term, ["Interjection", "Expression", "Adjective", "Adverb", "ProperNoun"])) return 3;
  if (hasTag(term, ["Preposition", "Conjunction", "Determiner", "Pronoun", "Articles", "StatesofBeingVerbs"])) {
    return 4;
  }
  return 5;
}

function scoreTerms(plainText, verseScores, chapterScores, rng) {
  return analyzeTerms(plainText).map(([text, priority]) => {
    const lower = text.toLowerCase();
    const tfidf =
      (verseScores[lower] || 0) * TFIDF_CONFIG.verseWeight +
      (chapterScores[lower] || 0) * TFIDF_CONFIG.chapterWeight;
    const finalScore =
      tfidf * TFIDF_CONFIG.tfidfWeight +
      ((6 - priority) / 5) * TFIDF_CONFIG.priorityWeight +
      (rng() - 0.5) * TFIDF_CONFIG.jitter;

    return { text, isPunct: priority === 0, finalScore };
  });
}

// Blank `count` words of a verse. Returns the verse as segments
// ({ text } runs and { blank: true, word } entries) and the blanked words in order.
// `scores` is { verse, chapter } word-score maps from buildTfidfContext.
export function buildBlankedVerse({ text, count, scores = {}, rng = Math.random }) {
  const plain = cleanVerseText(text);
  if (!plain) return { segments: [], words: [] };

  // Ignored words are never candidates, so a verse with too few real words blanks fewer
  const candidates = scoreTerms(plain, scores.verse || {}, scores.chapter || {}, rng).filter(
    (term) => !term.isPunct && term.text.trim() && !isIgnoredWord(term.text)
  );
  const target = Math.max(0, Math.min(Math.floor(count), candidates.length));
  const ranked = [...candidates].sort((a, b) => b.finalScore - a.finalScore);
  const pool = ranked.slice(0, Math.min(Math.max(target, 0) * 2, candidates.length));

  // Every place each candidate word occurs in the verse, in random order so
  // repeated words are blanked at a random spot
  const occurrences = new Map();
  for (const word of new Set(pool.map((term) => term.text.toLowerCase()))) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const found = [...plain.matchAll(new RegExp(`\\b${escaped}\\b`, "gi"))].map((match) => ({
      word: match[0],
      index: match.index,
    }));
    if (found.length) occurrences.set(word, shuffleWith(found, rng));
  }

  const chosen = [];
  const used = new Set();
  const goal = Math.min(target, candidates.length);
  let added = true;
  while (chosen.length < goal && added) {
    added = false;
    for (const term of pool) {
      if (chosen.length >= goal) break;
      const next = occurrences.get(term.text.toLowerCase())?.shift();
      if (next && !used.has(next.index)) {
        chosen.push(next);
        used.add(next.index);
        added = true;
      }
    }
  }
  chosen.sort((a, b) => a.index - b.index);

  const segments = [];
  const words = [];
  let cursor = 0;
  for (const { word, index } of chosen) {
    if (index < cursor) continue;
    if (index > cursor) segments.push({ text: plain.slice(cursor, index) });
    segments.push({ blank: true, word });
    words.push(word);
    cursor = index + word.length;
  }
  if (cursor < plain.length) segments.push({ text: plain.slice(cursor) });

  return { segments, words };
}

// --- Rendering helpers shared by every output ---

export function segmentsToText(segments, placeholder = BLANK_PLACEHOLDER) {
  return segments.map((segment) => (segment.blank ? placeholder : segment.text)).join("");
}

export function segmentsToAnswerText(segments) {
  return segments.map((segment) => (segment.blank ? segment.word : segment.text)).join("");
}
