export type InteractionType = {
  type: "yes-no";
} | {
  type: "choices";
  choices: string[];
};

/**
 * Detects if the assistant's message is asking for a Yes/No confirmation
 * or presenting multiple choices in [Option] format.
 */
export function detectInteraction(content: string): InteractionType | null {
  if (!content) return null;

  const normalized = content.trim().toLowerCase();
  
  // 1. Yes/No Detection
  const yesNoTriggers = [
    "continue?", "proceed?", "go ahead?", "is this correct?", 
    "is this okay?", "is this right?", "ready to proceed?",
    "want me to", "should i", "allow me to", "can i",
    "(yes/no)", "please confirm"
  ];

  const isQuestion = normalized.endsWith("?");
  const hasTrigger = yesNoTriggers.some(t => normalized.includes(t));

  // Determine if ANY part of the message is an informational question (How/What/Why/Who/Where/Which)
  // We split by common sentence delimiters (including newlines and colons)
  const parts = normalized.split(/\s*[\n.!?;:]\s*/);
  
  const isAnyInformational = parts.some(part => {
    const cleanPart = part.trim().replace(/^[#\s\-\*]+/, "");
    return (
      cleanPart.startsWith("how ") || 
      cleanPart.startsWith("what ") || 
      cleanPart.startsWith("why ") || 
      cleanPart.startsWith("who ") ||
      cleanPart.startsWith("where ") ||
      cleanPart.startsWith("which ")
    );
  });

  // Check if it looks like a list of options (e.g. 1. 2. 3. or * *)
  const hasNumberedList = /\n\s*\d+\.\s+/.test(normalized);
  const hasBulletedList = /\n\s*[\-\*]\s+/.test(normalized);
  const isLikelySelectionMenu = hasNumberedList || hasBulletedList;

  // We only trigger yes-no if:
  // 1. It contains a specific yes-no trigger OR is a general "do you/would you" question
  // 2. AND the message is NOT informational (How/What/Why)
  // 3. AND it doesn't look like a numbered/bulleted list of options
  // 4. UNLESS it explicitly has "(yes/no)" which overrides everything.
  const hasForcedMarker = normalized.includes("(yes/no)");

  if (hasForcedMarker) {
    return { type: "yes-no" };
  }

  if (!isAnyInformational && !isLikelySelectionMenu && (hasTrigger || (isQuestion && (
    normalized.includes("do you") || 
    normalized.includes("would you") ||
    normalized.includes("shall i") ||
    normalized.includes("can i")
  )))) {
    return { type: "yes-no" };
  }

  // 2. Multi-choice detection: looks for [Option] patterns
  const choiceMatches = content.match(/\[([^\]]+)\]/g);
  if (choiceMatches && choiceMatches.length >= 2) {
    const choices = [
      ...new Set(choiceMatches.map((m) => m.slice(1, -1).trim())),
    ].filter(c => c.length > 0 && c.length < 50); // Sanity check on choice length
    
    if (choices.length >= 2) {
      // Only trigger if near the end of the message or if explicitly asked to choose
      const lastChoiceIndex = content.lastIndexOf(choiceMatches[choiceMatches.length - 1]!);
      const isNearEnd = lastChoiceIndex > (content.length - 150);
      const asksToChoose = normalized.includes("choose") || normalized.includes("select") || normalized.includes("option");
      
      if (isNearEnd || asksToChoose) {
        return { type: "choices", choices };
      }
    }
  }

  return null;
}
