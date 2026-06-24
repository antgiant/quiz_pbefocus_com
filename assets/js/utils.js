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

export function nowLabel() {
  return new Date().toLocaleString();
}
