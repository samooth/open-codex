export type StateSnapshot = {
  overall_goal?: string;
  active_constraints?: string[];
  key_knowledge?: string[];
  artifact_trail?: string[];
  task_state?: string[];
};

/**
 * Parses XML-style tags from a content string to build or update a StateSnapshot.
 */
export function parseStateSnapshot(content: string): StateSnapshot | null {
  if (!content) return null;

  const snapshot: StateSnapshot = {};

  const goalMatch = content.match(/<overall_goal>([\s\S]*?)<\/overall_goal>/i);
  if (goalMatch) snapshot.overall_goal = goalMatch[1]!.trim();

  const constraintsMatch = content.match(/<active_constraints>([\s\S]*?)<\/active_constraints>/i);
  if (constraintsMatch) {
    snapshot.active_constraints = constraintsMatch[1]!
      .split("\n")
      .map(line => line.replace(/^[-\*\s]+/, "").trim())
      .filter(Boolean);
  }

  const knowledgeMatch = content.match(/<key_knowledge>([\s\S]*?)<\/key_knowledge>/i);
  if (knowledgeMatch) {
    snapshot.key_knowledge = knowledgeMatch[1]!
      .split("\n")
      .map(line => line.replace(/^[-\*\s]+/, "").trim())
      .filter(Boolean);
  }

  const artifactsMatch = content.match(/<artifact_trail>([\s\S]*?)<\/artifact_trail>/i);
  if (artifactsMatch) {
    snapshot.artifact_trail = artifactsMatch[1]!
      .split("\n")
      .map(line => line.replace(/^[-\*\s]+/, "").trim())
      .filter(Boolean);
  }

  const tasksMatch = content.match(/<task_state>([\s\S]*?)<\/task_state>/i);
  if (tasksMatch) {
    snapshot.task_state = tasksMatch[1]!
      .split("\n")
      .map(line => line.trim())
      .filter(Boolean);
  }

  return Object.keys(snapshot).length > 0 ? snapshot : null;
}

/**
 * Formats a StateSnapshot back into a string for injection into the system prompt.
 */
export function formatStateForPrompt(snapshot: StateSnapshot): string {
  const parts: string[] = ["\n--- CURRENT MISSION STATE ---"];
  
  if (snapshot.overall_goal) {
    parts.push(`Overall Goal: ${snapshot.overall_goal}`);
  }
  
  if (snapshot.active_constraints && snapshot.active_constraints.length > 0) {
    parts.push("Active Constraints:");
    snapshot.active_constraints.forEach(c => parts.push(` - ${c}`));
  }
  
  if (snapshot.key_knowledge && snapshot.key_knowledge.length > 0) {
    parts.push("Key Knowledge:");
    snapshot.key_knowledge.forEach(k => parts.push(` - ${k}`));
  }
  
  if (snapshot.artifact_trail && snapshot.artifact_trail.length > 0) {
    parts.push(`Artifact Trail: ${snapshot.artifact_trail.join(", ")}`);
  }
  
  if (snapshot.task_state && snapshot.task_state.length > 0) {
    parts.push("Task Progress:");
    snapshot.task_state.forEach(t => parts.push(` ${t}`));
  }

  parts.push("-----------------------------\n");
  return parts.join("\n");
}
