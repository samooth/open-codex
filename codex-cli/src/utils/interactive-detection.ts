export type InteractionType =
  | {
      type: "yes-no";
    }
  | {
      type: "choices";
      choices: Array<string>;
    };

/**
 * Detects if the assistant's message is asking for a Yes/No confirmation
 * or presenting multiple choices in [Option] format.
 */
export function detectInteraction(content: string): InteractionType | null {
  if (!content) {
    return null;
  }

  const normalized = content.trim().toLowerCase();

  // 1. Yes/No Detection
  // Expanded Yes/No detection keywords
  const strongTriggers = ["(yes/no)", "please confirm"];
  const weakTriggers = [
    "continue?",
    "proceed?",
    "go ahead?",
    "is this correct?",
    "is this okay?",
    "is this right?",
    "ready to proceed?",
    "want me to",
    "should i",
    "allow me to",
    "can i?",
    "can i ",
  ];

  const isQuestion = normalized.endsWith("?");

  // Detect open-ended question starters that should NEVER trigger Yes/No
  const openEndedStarters = [
    "how",
    "what",
    "why",
    "where",
    "who",
    "when",
    "which",
    "can i help",
    "can i do",
    "how can i",
  ];

  // Split into sentences and check if the message ends with an open-ended question
  const sentences = normalized.split(/[.!?](?:\s+|$)/).filter(Boolean);
  const lastSentence = sentences[sentences.length - 1] || "";
  const cleanSentence = lastSentence.replace(/^[#\s\-\*]+/, "").trim();
  const isLastSentenceOpenEnded = openEndedStarters.some((s) => {
    return (
      cleanSentence === s ||
      cleanSentence.startsWith(s + " ") ||
      cleanSentence.startsWith(s + "?")
    );
  });

  const hasStrongTrigger = strongTriggers.some((t) => normalized.includes(t));
  const hasWeakTrigger = weakTriggers.some((t) => normalized.includes(t));

  const isConfirmationQuestion =
    normalized.includes("do you want to") ||
    normalized.includes("would you like me to") ||
    normalized.includes("shall i") ||
    // Use word boundaries for "can i" to avoid matches inside "Bitcoin"
    /\bcan i\b/i.test(normalized) ||
    normalized.includes("should i");

  // Strong triggers work regardless of question mark (e.g. "Ready (yes/no)")
  if (hasStrongTrigger) {
    return { type: "yes-no" };
  }

  // Weak triggers and general confirmation phrasing require a trailing question mark
  // and MUST NOT be open-ended (e.g. "How can I help you?" vs "Can I help you?")
  if (
    isQuestion &&
    !isLastSentenceOpenEnded &&
    (hasWeakTrigger || isConfirmationQuestion)
  ) {
    return { type: "yes-no" };
  }

  // 2. Multi-choice detection: looks for [Option] patterns
  // We use a negative lookahead to ensure it's not a standard Markdown link [text](url)
  const choiceMatches = content.match(/\[([^\]]+)\](?!\()/g);
  if (choiceMatches && choiceMatches.length >= 2) {
    const choices = [
      ...new Set(choiceMatches.map((m) => m.slice(1, -1).trim())),
    ].filter((c) => c.length > 0 && c.length < 50); // Sanity check on choice length

    if (choices.length >= 2) {
      // Logic for detecting if this is a final interaction menu:
      // 1. If explicit 'choose' keywords are present, we are more lenient with position.
      // 2. If no keywords, we require it to be a question ending with the choices.
      const lastChoiceMatch = choiceMatches[choiceMatches.length - 1]!;
      const lastChoiceIndex = content.lastIndexOf(lastChoiceMatch);
      const trailingText = content
        .slice(lastChoiceIndex + lastChoiceMatch.length)
        .trim();

      const isNearEnd = lastChoiceIndex > content.length - 150;
      const isAtTheVeryEnd =
        trailingText.length <= 10 && /^[.!?]*$/.test(trailingText);

      const asksToChoose =
        normalized.includes("choose") ||
        normalized.includes("select") ||
        normalized.includes("option") ||
        normalized.includes("pick");
      const isQuestionAtEnd = normalized.trim().endsWith("?");

      if ((asksToChoose && isNearEnd) || (isQuestionAtEnd && isAtTheVeryEnd)) {
        return { type: "choices", choices };
      }
    }
  }

  return null;
}
