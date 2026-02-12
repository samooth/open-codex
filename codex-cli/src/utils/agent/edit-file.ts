import { readFileSync } from "fs";
import { createPatch } from "diff";
import chalk from "chalk";

export interface Edit {
  search: string;
  replace: string;
}

export interface EditResult {
  success: boolean;
  content?: string;
  diff?: string;
  error?: string;
}

export function applyEdits(filePath: string, edits: Edit[]): EditResult {
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch (err) {
    return { success: false, error: `Could not read file ${filePath}: ${err}` };
  }

  let newContent = content;
  for (const edit of edits) {
    const { search, replace } = edit;
    
    // Exact match check
    if (!newContent.includes(search)) {
      return { 
        success: false, 
        error: `Could not find exact match for search block in ${filePath}. Ensure whitespace and indentation match exactly.` 
      };
    }

    // Check for multiple matches to avoid ambiguity
    const occurrences = newContent.split(search).length - 1;
    if (occurrences > 1) {
       return {
         success: false,
         error: `Multiple occurrences of search block found in ${filePath}. Provide more context to make it unique.`
       };
    }

    newContent = newContent.replace(search, replace);
  }

  if (newContent === content) {
    return { success: false, error: "No changes made to the file." };
  }

  const standardDiff = createPatch(filePath, content, newContent);
  // Convert standard diff to OpenCodex format for the UI
  const diffLines = standardDiff.split("\n");
  const codexDiffLines = ["*** Begin Patch", `*** Update File: ${filePath}`];
  
  let startedHunks = false;
  for (const line of diffLines) {
    if (line.startsWith("@@")) {
      startedHunks = true;
      codexDiffLines.push(line);
    } else if (startedHunks) {
      if (line.startsWith("---") || line.startsWith("+++") || line.startsWith("\\ No newline")) {
         continue;
      }
      codexDiffLines.push(line);
    }
  }
  codexDiffLines.push("*** End Patch");
  const diff = codexDiffLines.join("\n");

  return {
    success: true,
    content: newContent,
    diff,
  };
}

export function formatStyledDiff(diff: string): string {
  const lines = diff.split("\n");
  let output = "";
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;

    if (line.startsWith("+") && !line.startsWith("+++")) {
      output += chalk.green(line) + "\n";
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      output += chalk.red(line) + "\n";
    } else if (line.startsWith("@@")) {
      output += chalk.cyan(line) + "\n";
    } else {
      output += line + "\n";
    }
  }
  
  return output;
}
