export function formatVerseRef(question) {
  const suffix =
    question.endVerse && question.endVerse !== question.startVerse
      ? `-${question.endVerse}`
      : "";
  return `${question.book} ${question.chapter}:${question.startVerse}${suffix}`;
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
