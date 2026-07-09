export function shuffle(array, seed = Date.now()) {
  const clone = [...array];
  let s = seed % 2147483647;
  if (s <= 0) {
    s += 2147483646;
  }

  function rand() {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  }

  for (let i = clone.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [clone[i], clone[j]] = [clone[j], clone[i]];
  }

  return clone;
}

export function uniqueById(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (seen.has(item.id)) {
      return false;
    }
    seen.add(item.id);
    return true;
  });
}

export function normalizeText(value) {
  return (value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function csvJoin(values) {
  return values.filter(Boolean).join(", ");
}

export function formatNumberRanges(values) {
  const normalized = Array.from(
    new Set((values || []).map((value) => Number(value)).filter((value) => Number.isFinite(value)))
  ).sort((a, b) => a - b);

  if (!normalized.length) {
    return "";
  }

  const ranges = [];
  let start = normalized[0];
  let previous = normalized[0];

  for (let i = 1; i < normalized.length; i += 1) {
    const current = normalized[i];
    if (current === previous + 1) {
      previous = current;
      continue;
    }

    ranges.push(start === previous ? `${start}` : `${start}-${previous}`);
    start = current;
    previous = current;
  }

  ranges.push(start === previous ? `${start}` : `${start}-${previous}`);
  return ranges.join(", ");
}

export function nowLabel() {
  return new Date().toLocaleString();
}

const AI_MODEL_HINTS = [
  "gpt",
  "gemini",
  "claude",
  "llama",
  "mistral",
  "copilot",
  "openai",
  "anthropic",
  "meta",
  "xai",
  "grok",
  "deepseek",
  "qwen",
  "phi",
  "titan",
  "palm",
  "llm",
];

export function isLikelyAiModelName(modelName) {
  const normalized = String(modelName || "").trim().toLowerCase();
  if (!normalized || normalized === "human") {
    return false;
  }

  return AI_MODEL_HINTS.some((hint) => normalized.includes(hint));
}

export function getQuestionSource(question) {
  const aiGenerated = isLikelyAiModelName(question?.model);
  const humanReviewed = String(question?.validatedBy || "").toLowerCase() === "human";

  if (!aiGenerated) {
    return "human_generated";
  }

  return humanReviewed ? "ai_human_reviewed" : "ai_unreviewed";
}

export function questionMatchesSelectedSources(question, selectedSources) {
  if (!Array.isArray(selectedSources) || selectedSources.length === 0) {
    return false;
  }

  return selectedSources.includes(getQuestionSource(question));
}
