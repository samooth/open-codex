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

  // Determine if the "primary" question is informational (How/What/Why/Who)
  // We split by common sentence delimiters and look at the last part if it ends with ?
  const parts = normalized.split(/[.!?;]\s+/);
  const lastPart = parts[parts.length - 1]?.trim() || "";
  
  // Strip markdown headers from the start of the last part
  const cleanLastPart = lastPart.replace(/^[#\s\-\*]+/, "");
  
  const isInformational = 
    cleanLastPart.startsWith("how ") || 
    cleanLastPart.startsWith("what ") || 
    cleanLastPart.startsWith("why ") || 
    cleanLastPart.startsWith("who ");

  // We only trigger yes-no if:
  // 1. It contains a specific yes-no trigger OR is a general "do you/would you" question
  // 2. AND the final question is NOT an informational "How/What/Why" question
  // 3. UNLESS it explicitly has "(yes/no)" which overrides everything.
  const hasForcedMarker = normalized.includes("(yes/no)");

  if (hasForcedMarker) {
    return { type: "yes-no" };
  }

  if (!isInformational && (hasTrigger || (isQuestion && (
    normalized.includes("do you") || 
    normalized.includes("would you") ||
    normalized.includes("shall i")
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
