// FIXED: Defensive parsing that never returns null

export type ApplyPatchCreateFileOp = {
  type: "create";
  path: string;
  content: string;
};

export type ApplyPatchDeleteFileOp = {
  type: "delete";
  path: string;
};

export type ApplyPatchUpdateFileOp = {
  type: "update";
  path: string;
  update: string;
  added: number;
  deleted: number;
};

export type ApplyPatchOp =
  | ApplyPatchCreateFileOp
  | ApplyPatchDeleteFileOp
  | ApplyPatchUpdateFileOp;

export const PATCH_PREFIX = "*** Begin Patch\n";
export const PATCH_SUFFIX = "\n*** End Patch";
export const ADD_FILE_PREFIX = "*** Add File: ";
export const DELETE_FILE_PREFIX = "*** Delete File: ";
export const UPDATE_FILE_PREFIX = "*** Update File: ";
export const MOVE_FILE_TO_PREFIX = "*** Move to: ";
export const END_OF_FILE_PREFIX = "*** End of File";
export const HUNK_ADD_LINE_PREFIX = "+";

export type ParseError = {
  message: string;
  line?: number;
  context?: string;
};

export type ParseResult = {
  ops: Array<ApplyPatchOp>;
  errors: Array<ParseError>;
  valid: boolean;
};

/**
 * Normalizes line endings to \n
 */
function normalizeLineEndings(text: string): string {
  if (typeof text !== "string") {
    return "";
  }
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/**
 * Safely extracts string value, returns empty string if not a string
 */
function safeString(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value === null || value === undefined) {
    return "";
  }
  try {
    return String(value);
  } catch {
    return "";
  }
}

/**
 * Parses apply patch format
 * NEVER returns null - always returns a valid ParseResult
 */
export function parseApplyPatch(patch: unknown): ParseResult {
  const errors: Array<ParseError> = [];
  
  // Validate input is a string
  const patchText = safeString(patch);
  
  if (patchText.length === 0) {
    errors.push({
      message: "Patch is empty or not a string",
      context: "Input was: " + String(patch).slice(0, 100)
    });
    return { ops: [], errors, valid: false };
  }
  
  // Normalize line endings
  const normalizedPatch = normalizeLineEndings(patchText);
  
  // Check for required markers
  if (!normalizedPatch.startsWith(PATCH_PREFIX)) {
    errors.push({
      message: "Patch must begin with '*** Begin Patch'",
      context: normalizedPatch.slice(0, 100)
    });
    // Try to fix by adding the prefix if content looks like a patch
    if (normalizedPatch.includes("*** Update File:") || 
        normalizedPatch.includes("*** Add File:") ||
        normalizedPatch.includes("*** Delete File:")) {
      // Continue processing with wrapped content
    } else {
      return { ops: [], errors, valid: false };
    }
  }
  
  if (!normalizedPatch.endsWith(PATCH_SUFFIX)) {
    errors.push({
      message: "Patch must end with '*** End Patch'",
      context: normalizedPatch.slice(-100)
    });
    // Try to fix by adding the suffix
  }

  // Extract body between markers, or use entire content if markers missing
  let patchBody: string;
  if (normalizedPatch.startsWith(PATCH_PREFIX) && normalizedPatch.endsWith(PATCH_SUFFIX)) {
    patchBody = normalizedPatch.slice(
      PATCH_PREFIX.length,
      normalizedPatch.length - PATCH_SUFFIX.length,
    );
  } else if (normalizedPatch.startsWith(PATCH_PREFIX)) {
    patchBody = normalizedPatch.slice(PATCH_PREFIX.length);
  } else if (normalizedPatch.endsWith(PATCH_SUFFIX)) {
    patchBody = normalizedPatch.slice(0, -PATCH_SUFFIX.length);
  } else {
    // Wrap the content
    patchBody = normalizedPatch;
  }

  const lines = patchBody.split("\n");
  const ops: Array<ApplyPatchOp> = [];
  let lineNum = 2; // Start after PATCH_PREFIX

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    
    if (line.startsWith(END_OF_FILE_PREFIX)) {
      lineNum++;
      continue;
    } else if (line.startsWith(ADD_FILE_PREFIX)) {
      const path = safeString(line.slice(ADD_FILE_PREFIX.length).trim());
      if (path) {
        ops.push({
          type: "create",
          path,
          content: "",
        });
      } else {
        errors.push({
          message: "Add File operation missing path",
          line: lineNum,
          context: line
        });
      }
      lineNum++;
      continue;
    } else if (line.startsWith(DELETE_FILE_PREFIX)) {
      const path = safeString(line.slice(DELETE_FILE_PREFIX.length).trim());
      if (path) {
        ops.push({
          type: "delete",
          path,
        });
      } else {
        errors.push({
          message: "Delete File operation missing path",
          line: lineNum,
          context: line
        });
      }
      lineNum++;
      continue;
    } else if (line.startsWith(UPDATE_FILE_PREFIX)) {
      const path = safeString(line.slice(UPDATE_FILE_PREFIX.length).trim());
      if (path) {
        ops.push({
          type: "update",
          path,
          update: "",
          added: 0,
          deleted: 0,
        });
      } else {
        errors.push({
          message: "Update File operation missing path",
          line: lineNum,
          context: line
        });
      }
      lineNum++;
      continue;
    }

    const lastOp = ops[ops.length - 1];

    // If no operation has been started yet, skip or error
    if (!lastOp) {
      // Skip empty lines or lines that are just whitespace
      if (line.trim().length === 0 || line.startsWith("@@")) {
        lineNum++;
        continue;
      }
      errors.push({
        message: `Line encountered before any file operation: ${safeString(line).slice(0, 50)}`,
        line: lineNum,
        context: line
      });
      lineNum++;
      continue;
    }

    if (lastOp.type === "create") {
      if (line.startsWith("@@")) {
        lineNum++;
        continue;
      }
      const contentLine = line.startsWith(HUNK_ADD_LINE_PREFIX)
        ? line.slice(HUNK_ADD_LINE_PREFIX.length)
        : line;
      lastOp.content = appendLine(lastOp.content, contentLine);
      lineNum++;
      continue;
    }

    if (lastOp.type !== "update") {
      errors.push({
        message: `Expected update op but got ${lastOp.type} for line: ${safeString(line).slice(0, 50)}`,
        line: lineNum,
        context: line
      });
      lineNum++;
      continue;
    }

    if (line.startsWith(HUNK_ADD_LINE_PREFIX)) {
      lastOp.added += 1;
    } else if (line.startsWith("-")) {
      lastOp.deleted += 1;
    }
    lastOp.update += lastOp.update ? "\n" + line : line;
    lineNum++;
  }

  // Validate that we have at least one operation
  if (ops.length === 0 && errors.length === 0) {
    errors.push({
      message: "No file operations found in patch"
    });
  }

  return { 
    ops, 
    errors, 
    valid: errors.length === 0 && ops.length > 0 
  };
}

function appendLine(content: string, line: string): string {
  const safeContent = safeString(content);
  const safeLine = safeString(line);
  
  if (safeContent.length === 0) {
    return safeLine;
  }
  return safeContent + "\n" + safeLine;
}

// Backward compatibility - returns null for invalid patches (old behavior)
// but internally uses the new safe parser
export function parseApplyPatchLegacy(patch: unknown): Array<ApplyPatchOp> | null {
  const result = parseApplyPatch(patch);
  if (!result.valid || result.errors.length > 0) {
    return null;
  }
  return result.ops;
}