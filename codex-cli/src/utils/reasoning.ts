export interface ReasoningParts {
  displayContent: string;
  thoughts: string[];
  plans: string[];
}

/**
 * Extract <thought>/<think>/<thinking> and <plan>/<roadmap> blocks from a
 * message's text content, returning the remaining display content plus the
 * extracted reasoning/plan snippets.
 *
 * Handles both fully-closed blocks and (during streaming) unclosed tag blocks
 * so the live reasoning can be shown by the input indicator without leaving
 * orphaned opening tags in the main answer text.
 *
 * This is the single source of truth for reasoning/plan extraction used by the
 * message renderer.
 */
export function extractReasoningParts(content: string): ReasoningParts {
  const thoughts: string[] = [];
  const plans: string[] = [];

  const closedThoughtRegex =
    /<(thought|think|thinking)>([\s\S]*?)<\/(?:thought|think|thinking)>/gim;
  const closedPlanRegex = /<(plan|roadmap)>([\s\S]*?)<\/(?:plan|roadmap)>/gim;
  const closedResponseRegex = /<response>([\s\S]*?)<\/response>/gim;

  let displayContent = content.replace(
    closedThoughtRegex,
    (_m, _tag, thought) => {
      thoughts.push(thought.trim());
      return "";
    },
  );

  displayContent = displayContent.replace(closedPlanRegex, (_m, _tag, plan) => {
    plans.push(plan.trim());
    return "";
  });

  displayContent = displayContent.replace(closedResponseRegex, (_m, resp) => resp);

  const unclosedTags = [
    {
      type: "thought" as const,
      match: displayContent.match(
        /<(thought|think|thinking)>(?![\s\S]*<\/\1>)([\s\S]*?)(?=(?:<(thought|think|thinking)|$))/i,
      ),
    },
    {
      type: "plan" as const,
      match: displayContent.match(
        /<(plan|roadmap)>(?![\s\S]*<\/\1>)([\s\S]*?)(?=(?:<(plan|roadmap)|$))/i,
      ),
    },
    {
      type: "response" as const,
      match: displayContent.match(
        /<response>(?![\s\S]*<\/response>)([\s\S]*?)(?=(?:<response|$))/i,
      ),
    },
  ]
    .filter((t) => t.match !== null)
    .sort((a, b) => a.match!.index! - b.match!.index!);

  if (unclosedTags.length > 0) {
    const firstUnclosed = unclosedTags[0]!;
    const firstIndex = firstUnclosed.match!.index!;

    for (const tag of unclosedTags) {
      if (tag.type === "thought") {
        thoughts.push(tag.match![2]!.trim());
      } else if (tag.type === "plan") {
        plans.push(tag.match![2]!.trim());
      }
    }

    if (firstUnclosed.type !== "response") {
      displayContent = displayContent.slice(0, firstIndex);
    } else {
      displayContent = displayContent.slice(0, firstIndex) + firstUnclosed.match![1];
    }
  }

  displayContent = displayContent
    .replace(/<\/(thought|think|thinking|plan|roadmap|response)>/gim, "")
    .trim();

  return { displayContent, thoughts, plans };
}
