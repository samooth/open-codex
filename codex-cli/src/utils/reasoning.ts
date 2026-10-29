export interface ReasoningParts {
  displayContent: string;
  thoughts: string[];
  plans: string[];
}

// Tag aliases recognised as reasoning/thought blocks.
const THOUGHT_TAGS =
  "thought|think|thinking|reasoning|analysis|scratchpad|internal";
// Tag aliases recognised as plan blocks.
const PLAN_TAGS = "plan|roadmap|strategy";
// Tag aliases whose content should be treated as the final response.
const RESPONSE_TAGS = "response|answer|final";

function stripOrphanCloses(text: string): string {
  return text.replace(
    new RegExp(`</(${THOUGHT_TAGS}|${PLAN_TAGS}|${RESPONSE_TAGS})>`, "gim"),
    "",
  );
}

function clean(s: string): string {
  return s.replace(/\r\n/g, "\n").trim();
}

function dedupe(list: string[]): string[] {
  const out: string[] = [];
  for (const item of list) {
    if (item && (out.length === 0 || out[out.length - 1] !== item)) {
      out.push(item);
    }
  }
  return out;
}

/**
 * Extract <thought>/<think>/<thinking>/... and <plan>/... blocks from a
 * message's text content, returning the remaining display content plus the
 * extracted reasoning/plan snippets.
 *
 * Handles fully-closed blocks, unclosed (streaming) blocks, tags with
 * attributes, orphaned closing tags and interleaved content. This is the
 * single source of truth for reasoning/plan extraction used by the renderer.
 */
export function extractReasoningParts(content: string): ReasoningParts {
  if (!content) {
    return { displayContent: "", thoughts: [], plans: [] };
  }

  const thoughts: string[] = [];
  const plans: string[] = [];

  const closedThoughtRegex = new RegExp(
    `<(?:${THOUGHT_TAGS})(?:\\s[^>]*)?>([\\s\\S]*?)</(?:${THOUGHT_TAGS})>`,
    "gim",
  );
  const closedPlanRegex = new RegExp(
    `<(?:${PLAN_TAGS})(?:\\s[^>]*)?>([\\s\\S]*?)</(?:${PLAN_TAGS})>`,
    "gim",
  );
  const closedResponseRegex = new RegExp(
    `<(?:${RESPONSE_TAGS})(?:\\s[^>]*)?>([\\s\\S]*?)</(?:${RESPONSE_TAGS})>`,
    "gim",
  );

  let displayContent = content.replace(closedThoughtRegex, (_m, thought) => {
    const t = clean(thought);
    if (t) thoughts.push(t);
    return "";
  });

  displayContent = displayContent.replace(closedPlanRegex, (_m, plan) => {
    const p = clean(plan);
    if (p) plans.push(p);
    return "";
  });

  displayContent = displayContent.replace(closedResponseRegex, (_m, resp) =>
    clean(resp),
  );

  // Unclosed (streaming) tags: a tag that has been opened but not yet closed.
  const unclosedCandidates: Array<{
    type: "thought" | "plan" | "response";
    index: number;
    tag: string;
    content: string;
  }> = [];

  const unclosedThought = displayContent.match(
    new RegExp(
      `<(?:${THOUGHT_TAGS})(?:\\s[^>]*)?>(?![\\s\\S]*</(?:${THOUGHT_TAGS})>)([\\s\\S]*?)(?=<(?:${THOUGHT_TAGS}|${PLAN_TAGS}|${RESPONSE_TAGS})|$)`,
      "i",
    ),
  );
  if (unclosedThought && unclosedThought.index !== undefined) {
    unclosedCandidates.push({
      type: "thought",
      index: unclosedThought.index,
      tag: unclosedThought[0].match(/^<([a-zA-Z]+)/)?.[1] ?? "thought",
      content: clean(unclosedThought[1] ?? ""),
    });
  }

  const unclosedPlan = displayContent.match(
    new RegExp(
      `<(?:${PLAN_TAGS})(?:\\s[^>]*)?>(?![\\s\\S]*</(?:${PLAN_TAGS})>)([\\s\\S]*?)(?=<(?:${THOUGHT_TAGS}|${PLAN_TAGS}|${RESPONSE_TAGS})|$)`,
      "i",
    ),
  );
  if (unclosedPlan && unclosedPlan.index !== undefined) {
    unclosedCandidates.push({
      type: "plan",
      index: unclosedPlan.index,
      tag: unclosedPlan[0].match(/^<([a-zA-Z]+)/)?.[1] ?? "plan",
      content: clean(unclosedPlan[1] ?? ""),
    });
  }

  const unclosedResponse = displayContent.match(
    new RegExp(
      `<(?:${RESPONSE_TAGS})(?:\\s[^>]*)?>(?![\\s\\S]*</(?:${RESPONSE_TAGS})>)([\\s\\S]*?)(?=<(?:${THOUGHT_TAGS}|${PLAN_TAGS}|${RESPONSE_TAGS})|$)`,
      "i",
    ),
  );
  if (unclosedResponse && unclosedResponse.index !== undefined) {
    unclosedCandidates.push({
      type: "response",
      index: unclosedResponse.index,
      tag: unclosedResponse[0].match(/^<([a-zA-Z]+)/)?.[1] ?? "response",
      content: clean(unclosedResponse[1] ?? ""),
    });
  }

  unclosedCandidates.sort((a, b) => a.index - b.index);

  if (unclosedCandidates.length > 0) {
    const first = unclosedCandidates[0]!;
    for (const c of unclosedCandidates) {
      if (c.type === "thought" && c.content) thoughts.push(c.content);
      else if (c.type === "plan" && c.content) plans.push(c.content);
    }
    if (first.type !== "response") {
      displayContent = displayContent.slice(0, first.index);
    } else {
      displayContent = displayContent.slice(0, first.index) + first.content;
    }
  }

  displayContent = stripOrphanCloses(displayContent).trim();

  return {
    displayContent,
    thoughts: dedupe(thoughts),
    plans: dedupe(plans),
  };
}
