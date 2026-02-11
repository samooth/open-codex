// Based on reference implementation from
// https://cookbook.openai.com/examples/gpt4-1_prompting_guide#reference-implementation-apply_patchpy

import { dirname } from "path";
import {
  ADD_FILE_PREFIX,
  DELETE_FILE_PREFIX,
  END_OF_FILE_PREFIX,
  MOVE_FILE_TO_PREFIX,
  PATCH_SUFFIX,
  UPDATE_FILE_PREFIX,
  HUNK_ADD_LINE_PREFIX,
  PATCH_PREFIX as _PATCH_PREFIX,
} from "src/parse-apply-patch";

// -----------------------------------------------------------------------------
// Types & Models
// -----------------------------------------------------------------------------

export enum ActionType {
  ADD = "add",
  DELETE = "delete",
  UPDATE = "update",
}

export interface FileChange {
  type: ActionType;
  old_content?: string | null;
  new_content?: string | null;
  move_path?: string | null;
}

export interface Commit {
  changes: Record<string, FileChange>;
}

export function assemble_changes(
  orig: Record<string, string | null>,
  updatedFiles: Record<string, string | null>,
): Commit {
  const commit: Commit = { changes: {} };
  for (const [p, newContent] of Object.entries(updatedFiles)) {
    const oldContent = orig[p];
    if (oldContent === newContent) {
      continue;
    }
    if (oldContent !== undefined && newContent !== undefined) {
      commit.changes[p] = {
        type: ActionType.UPDATE,
        old_content: oldContent,
        new_content: newContent,
      };
    } else if (newContent !== undefined) {
      commit.changes[p] = {
        type: ActionType.ADD,
        new_content: newContent,
      };
    } else if (oldContent !== undefined) {
      commit.changes[p] = {
        type: ActionType.DELETE,
        old_content: oldContent,
      };
    } else {
      throw new Error("Unexpected state in assemble_changes");
    }
  }
  return commit;
}

// -----------------------------------------------------------------------------
// Patch‑related structures
// -----------------------------------------------------------------------------

export interface Chunk {
  orig_index: number; // line index of the first line in the original file
  del_lines: Array<string>;
  ins_lines: Array<string>;
}

export interface PatchAction {
  type: ActionType;
  new_file?: string | null;
  chunks: Array<Chunk>;
  move_path?: string | null;
}

export interface Patch {
  actions: Record<string, PatchAction>;
}

export class DiffError extends Error {}

// -----------------------------------------------------------------------------
// Parser (patch text -> Patch)
// -----------------------------------------------------------------------------

class Parser {
  current_files: Record<string, string>;
  lines: Array<string>;
  index = 0;
  patch: Patch = { actions: {} };
  fuzz = 0;

  constructor(currentFiles: Record<string, string>, lines: Array<string>) {
    this.current_files = currentFiles;
    this.lines = lines;
  }

  private is_done(prefixes?: Array<string>): boolean {
    if (this.index >= this.lines.length) {
      return true;
    }
    if (
      prefixes &&
      prefixes.some((p) => this.lines[this.index]!.startsWith(p.trim()))
    ) {
      return true;
    }
    return false;
  }

  private startswith(prefix: string | Array<string>): boolean {
    const prefixes = Array.isArray(prefix) ? prefix : [prefix];
    return prefixes.some((p) => this.lines[this.index]!.startsWith(p));
  }

  private read_str(prefix = "", returnEverything = false): string {
    if (this.index >= this.lines.length) {
      throw new DiffError(`Index: ${this.index} >= ${this.lines.length}`);
    }
    if (this.lines[this.index]!.startsWith(prefix)) {
      const text = returnEverything
        ? this.lines[this.index]
        : this.lines[this.index]!.slice(prefix.length);
      this.index += 1;
      return text ?? "";
    }
    return "";
  }

  parse(): void {
    while (!this.is_done([PATCH_SUFFIX])) {
      let path = this.read_str(UPDATE_FILE_PREFIX);
      if (path) {
        if (this.patch.actions[path]) {
          throw new DiffError(`Update File Error: Duplicate Path: ${path}`);
        }
        const moveTo = this.read_str(MOVE_FILE_TO_PREFIX);
        const text = this.current_files[path];
        const action = this.parse_update_file(text ?? "", path);
        action.move_path = moveTo || undefined;
        this.patch.actions[path] = action;
        continue;
      }
      path = this.read_str(DELETE_FILE_PREFIX);
      if (path) {
        if (this.patch.actions[path]) {
          throw new DiffError(`Delete File Error: Duplicate Path: ${path}`);
        }
        if (!(path in this.current_files)) {
          throw new DiffError(`Delete File Error: Missing File: ${path}`);
        }
        this.patch.actions[path] = { type: ActionType.DELETE, chunks: [] };
        continue;
      }
      path = this.read_str(ADD_FILE_PREFIX);
      if (path) {
        if (this.patch.actions[path]) {
          throw new DiffError(`Add File Error: Duplicate Path: ${path}`);
        }
        if (path in this.current_files) {
          throw new DiffError(`Add File Error: File already exists: ${path}`);
        }
        this.patch.actions[path] = this.parse_add_file();
        continue;
      }
      throw new DiffError(`Unknown Line: ${this.lines[this.index]}`);
    }
    if (!this.startswith(PATCH_SUFFIX.trim())) {
      throw new DiffError("Missing End Patch");
    }
    this.index += 1;
  }

  // FIXED: Better new file detection

private parse_update_file(text: string, _filePath: string): PatchAction {
  const action: PatchAction = { type: ActionType.UPDATE, chunks: [] };
  const fileLines = text.split("\n");
  let index = 0;
  
  // BETTER: Check if file is actually empty/new based on content, not heuristics
  const isNewFile = text === "" || fileLines.length === 0 || fileLines.every(line => line.trim() === "");

  while (
    !this.is_done([
      PATCH_SUFFIX,
      UPDATE_FILE_PREFIX,
      DELETE_FILE_PREFIX,
      ADD_FILE_PREFIX,
      END_OF_FILE_PREFIX,
    ])
  ) {
    const defStr = this.read_str("@@ ");
    let sectionStr = "";
    if (!defStr && this.lines[this.index] === "@@") {
      sectionStr = this.lines[this.index]!;
      this.index += 1;
    }
    if (!(defStr || sectionStr || index === 0)) {
      throw new DiffError(`Invalid Line:\n${this.lines[this.index]}`);
    }
    
    // Parse hunk header to get line numbers
    let hunkStartLine = 0;
    let hunkOldCount = 0;
    if (defStr) {
      const match = defStr.match(/@@ -(\d+),(\d+) \+(\d+),(\d+) @@/);
      if (match && match[1] && match[2]) {
        hunkStartLine = parseInt(match[1], 10) - 1; // Convert to 0-indexed
        hunkOldCount = parseInt(match[2], 10);
      }
    }
    
    // Use hunk header info instead of fragile heuristics
    const isNewFileHunk = isNewFile || (hunkStartLine === 0 && hunkOldCount === 0) || (hunkStartLine === -1 && hunkOldCount === 0);
    
    if (defStr.trim() && !isNewFileHunk) {
      // Try to find the context in the original file
      let found = false;
      const searchStart = Math.max(0, hunkStartLine - 1); // Allow 1 line of fuzz
      
      for (let i = searchStart; i < fileLines.length && i < hunkStartLine + 3; i++) {
        if (fileLines[i] === defStr) {
          index = i + 1;
          found = true;
          break;
        }
      }
      
      if (!found) {
        // Try trim match
        for (let i = searchStart; i < fileLines.length && i < hunkStartLine + 3; i++) {
          if (fileLines[i]!.trim() === defStr.trim()) {
            index = i + 1;
            this.fuzz += 1;
            found = true;
            break;
          }
        }
      }
    }

    const [nextChunkContext, chunks, endPatchIndex, eof] = peek_next_section(
      this.lines,
      this.index,
      isNewFileHunk,
    );
    const [newIndex, fuzz] = find_context(
      fileLines,
      nextChunkContext,
      index,
      eof,
    );
    if (newIndex === -1) {
      const ctxText = nextChunkContext.join("\n");
      if (eof) {
        throw new DiffError(`Invalid EOF Context ${index}:\n${ctxText}`);
      } else {
        throw new DiffError(`Invalid Context ${index}:\n${ctxText}`);
      }
    }
    this.fuzz += fuzz;
    for (const ch of chunks) {
      ch.orig_index += newIndex;
      action.chunks.push(ch);
    }
    index = newIndex + nextChunkContext.length;
    this.index = endPatchIndex;
  }
  return action;
}


  private parse_add_file(): PatchAction {
    const lines: Array<string> = [];
    while (
      !this.is_done([
        PATCH_SUFFIX,
        UPDATE_FILE_PREFIX,
        DELETE_FILE_PREFIX,
        ADD_FILE_PREFIX,
      ])
    ) {
      const s = this.read_str();
      if (s.startsWith("@@")) {
        continue;
      }
      if (s.startsWith(HUNK_ADD_LINE_PREFIX)) {
        lines.push(s.slice(1));
      } else {
        // Lenient: if it doesn't start with +, just add it as is
        lines.push(s);
      }
    }
    return {
      type: ActionType.ADD,
      new_file: lines.join("\n"),
      chunks: [],
    };
  }
}

// FIXED: Proper fuzzy matching without JSON.stringify

function find_context_core(
  lines: Array<string>,
  context: Array<string>,
  start: number,
): [number, number] {
  if (context.length === 0) {
    return [start, 0];
  }
  
  // Try exact match first
  for (let i = start; i < lines.length; i++) {
    if (lines.slice(i, i + context.length).join("\n") === context.join("\n")) {
      return [i, 0];
    }
  }
  
  // Try trimEnd match (ignore trailing whitespace)
  for (let i = start; i < lines.length; i++) {
    const slice = lines.slice(i, i + context.length);
    if (slice.length !== context.length) continue;
    
    let matches = true;
    for (let j = 0; j < context.length; j++) {
      if (slice[j]!.trimEnd() !== context[j]!.trimEnd()) {
        matches = false;
        break;
      }
    }
    if (matches) {
      return [i, 1]; // Small fuzz penalty for trailing whitespace mismatch
    }
  }
  
  // Try trim match (ignore all leading/trailing whitespace)
  for (let i = start; i < lines.length; i++) {
    const slice = lines.slice(i, i + context.length);
    if (slice.length !== context.length) continue;
    
    let matches = true;
    for (let j = 0; j < context.length; j++) {
      if (slice[j]!.trim() !== context[j]!.trim()) {
        matches = false;
        break;
      }
    }
    if (matches) {
      return [i, 10]; // Higher fuzz penalty for whitespace mismatch
    }
  }
  
  // Try normalized match (ignore empty lines and extra whitespace)
  const normalizedContext = context.map(s => s.trim()).filter(Boolean);
  if (normalizedContext.length > 0) {
    for (let i = start; i <= lines.length - normalizedContext.length; i++) {
      const windowSlice = lines.slice(i, i + normalizedContext.length);
      const normalizedWindow = windowSlice.map(s => s.trim()).filter(Boolean);
      
      if (normalizedWindow.length !== normalizedContext.length) continue;
      
      let matches = true;
      for (let j = 0; j < normalizedContext.length; j++) {
        if (normalizedWindow[j] !== normalizedContext[j]) {
          matches = false;
          break;
        }
      }
      
      if (matches) {
        return [i, 100]; // High fuzz penalty for normalized match
      }
    }
  }
  
  return [-1, 0];
}



function find_context(
  lines: Array<string>,
  context: Array<string>,
  start: number,
  eof: boolean,
): [number, number] {
  if (eof) {
    let [newIndex, fuzz] = find_context_core(
      lines,
      context,
      lines.length - context.length,
    );
    if (newIndex !== -1) {
      return [newIndex, fuzz];
    }
    [newIndex, fuzz] = find_context_core(lines, context, start);
    return [newIndex, fuzz + 10000];
  }
  return find_context_core(lines, context, start);
}

function peek_next_section(
  lines: Array<string>,
  initialIndex: number,
  isNewFile = false,
): [Array<string>, Array<Chunk>, number, boolean] {
  let index = initialIndex;
  const old: Array<string> = [];
  let delLines: Array<string> = [];
  let insLines: Array<string> = [];
  const chunks: Array<Chunk> = [];
  let mode: "keep" | "add" | "delete" = "keep";

  while (index < lines.length) {
    const s = lines[index]!;
    if (
      [
        "@@",
        PATCH_SUFFIX,
        UPDATE_FILE_PREFIX,
        DELETE_FILE_PREFIX,
        ADD_FILE_PREFIX,
        END_OF_FILE_PREFIX,
      ].some((p) => s.startsWith(p?.trim()))
    ) {
      break;
    }
    if (s === "***") {
      break;
    }
    if (s.startsWith("***")) {
      throw new DiffError(`Invalid Line: ${s}`);
    }
    index += 1;
    const lastMode: "keep" | "add" | "delete" = mode;
    let line = s;
    if (line[0] === HUNK_ADD_LINE_PREFIX) {
      mode = "add";
    } else if (line[0] === "-") {
      mode = "delete";
    } else if (line[0] === " ") {
      mode = "keep";
    } else {
      // If we are in a new file (hunk -0,0 or -1,1 on empty file), assume additions.
      // Models often forget the '+' prefix when writing whole new files.
      if (isNewFile) {
        mode = "add";
      } else {
        mode = "keep";
        line = " " + line;
      }
    }

    line = line.slice(1);
    
    if (mode === "keep" && lastMode !== mode) {
      if (insLines.length || delLines.length) {
        chunks.push({
          orig_index: old.length - delLines.length,
          del_lines: delLines,
          ins_lines: insLines,
        });
      }
      delLines = [];
      insLines = [];
    }
    if (mode === "delete") {
      delLines.push(line);
      old.push(line);
    } else if (mode === "add") {
      insLines.push(line);
    } else {
      old.push(line);
    }
  }
  if (insLines.length || delLines.length) {
    chunks.push({
      orig_index: old.length - delLines.length,
      del_lines: delLines,
      ins_lines: insLines,
    });
  }
  if (index < lines.length && lines[index] === END_OF_FILE_PREFIX) {
    index += 1;
    return [old, chunks, index, true];
  }
  return [old, chunks, index, false];
}

// -----------------------------------------------------------------------------
// High‑level helpers
// -----------------------------------------------------------------------------

// REMOVED: decodeHtmlEntities function entirely - it causes data corruption
// REMOVED: Aggressive HTML entity decoding that corrupted legitimate content

// FIXED: Only normalize patch markers, don't touch content
function normalizePatchText(text: string): string {
  // First, normalize line endings
  let cleaned = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n")?.trim();

  // Remove markdown code blocks if present (only at start/end)
  if (cleaned.startsWith("```")) {
    const lines = cleaned.split("\n");
    if (lines[0]?.startsWith("```")) {
      lines.shift();
    }
    if (lines[lines.length - 1]?.startsWith("```")) {
      lines.pop();
    }
    cleaned = lines.join("\n")?.trim();
  }

  // Handle mixed escaping by ensuring real newlines
  // Only replace \\n when it's not already a real newline
  cleaned = cleaned.replace(/([^\\])\\n/g, "$1\n");

  // Convert standard unified diff format to our format (if needed)
  const lines = cleaned.split("\n");
  const processedLines: string[] = [];
  let currentFile: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    
    // Standard unified diff: --- a/file or --- file
    if (line.startsWith("--- ")) {
      const potential = line.slice(4).split("\t")[0]?.trim() || "";
      // Skip /dev/null (means file is being deleted)
      if (potential === "/dev/null") {
        continue;
      }
      // Extract filename, removing a/ or b/ prefix if present
      const filename = potential.replace(/^[ab]\//, "");
      if (filename && filename !== currentFile) {
        processedLines.push(`*** Update File: ${filename}`);
        currentFile = filename;
      }
      continue;
    }
    
    // Standard unified diff: +++ b/file or +++ file
    if (line.startsWith("+++ ")) {
      const potential = line.slice(4).split("\t")[0]?.trim() || "";
      if (potential === "/dev/null") {
        // File is being deleted - convert to delete operation
        if (currentFile) {
          processedLines.pop(); // Remove the update file we just added
          processedLines.push(`*** Delete File: ${currentFile}`);
        }
        continue;
      }
      // Otherwise, this is just the new file confirmation, skip it
      continue;
    }
    
    // Fix cases where models put a space before @@
    if (line?.trim().startsWith("@@") && line.startsWith(" ")) {
      processedLines.push(line.trim());
      continue;
    }

    processedLines.push(line);
  }
  
  cleaned = processedLines.join("\n").trim();

  const hasBegin = cleaned.includes("*** Begin Patch");
  const hasEnd = cleaned.includes("*** End Patch");

  if (hasBegin && hasEnd) {
    // Extract everything between markers if they exist
    const startIdx = cleaned.indexOf("*** Begin Patch");
    const endIdx = cleaned.indexOf("*** End Patch") + "*** End Patch".length;
    return cleaned.slice(startIdx, endIdx);
  }

  // If markers are missing but it looks like our format, wrap it
  if (
    cleaned.includes("*** Update File:") ||
    cleaned.includes("*** Add File:") ||
    cleaned.includes("*** Delete File:")
  ) {
    return `*** Begin Patch\n${cleaned}\n*** End Patch`;
  }

  return cleaned;
}


export function text_to_patch(
  text: string,
  orig: Record<string, string>,
): [Patch, number] {
  const normalized = normalizePatchText(text);
  const lines = normalized.trim().split("\n");
  
  if (lines.length < 2) {
    throw new DiffError("Patch text is too short");
  }

  // Be more lenient with prefix/suffix matching
  const firstLine = lines[0] ?? "";
  const lastLine = lines[lines.length - 1] ?? "";

  if (!firstLine.includes("Begin Patch") || !lastLine.includes("End Patch")) {
    throw new DiffError("Invalid patch text: missing markers");
  }

  const parser = new Parser(orig, lines);
  parser.index = 1;
  parser.parse();
  return [parser.patch, parser.fuzz];
}

export function identify_files_needed(text: string): Array<string> {
  const normalized = normalizePatchText(text);
  const lines = normalized.trim().split("\n");
  const result = new Set<string>();
  for (const line of lines) {
    if (line.startsWith(UPDATE_FILE_PREFIX)) {
      result.add(line.slice(UPDATE_FILE_PREFIX.length).trim());
    }
    if (line.startsWith(DELETE_FILE_PREFIX)) {
      result.add(line.slice(DELETE_FILE_PREFIX.length).trim());
    }
  }
  return [...result];
}

export function identify_files_added(text: string): Array<string> {
  const normalized = normalizePatchText(text);
  const lines = normalized.trim().split("\n");
  const result = new Set<string>();
  for (const line of lines) {
    if (line.startsWith(ADD_FILE_PREFIX)) {
      result.add(line.slice(ADD_FILE_PREFIX.length).trim());
    }
  }
  return [...result];
}

function _get_updated_file(
  text: string,
  action: PatchAction,
  _path: string,
): string {
  if (action.type !== ActionType.UPDATE) {
    throw new Error("Expected UPDATE action");
  }
  const origLines = text.split("\n");
  const destLines: Array<string> = [];
  let origIndex = 0;
  for (const chunk of action.chunks) {
    if (chunk.orig_index > origLines.length) {
      // Lenient: if orig_index is out of bounds, just append to the end or try to find a match
      // but for now let's keep the error or be slightly more lenient
      chunk.orig_index = Math.min(chunk.orig_index, origLines.length);
    }
    if (origIndex > chunk.orig_index) {
      // Overlapping chunks or out of order - should not happen with good parser
      origIndex = chunk.orig_index; 
    }
    destLines.push(...origLines.slice(origIndex, chunk.orig_index));
    const delta = chunk.orig_index - origIndex;
    origIndex += delta;

    // inserted lines
    if (chunk.ins_lines.length) {
      for (const l of chunk.ins_lines) {
        destLines.push(l);
      }
    }
    origIndex += chunk.del_lines.length;
  }
  destLines.push(...origLines.slice(origIndex));
  return destLines.join("\n");
}

export function patch_to_commit(
  patch: Patch,
  orig: Record<string, string>,
): Commit {
  const commit: Commit = { changes: {} };
  for (const [pathKey, action] of Object.entries(patch.actions)) {
    if (action.type === ActionType.DELETE) {
      commit.changes[pathKey] = {
        type: ActionType.DELETE,
        old_content: orig[pathKey],
      };
    } else if (action.type === ActionType.ADD) {
      commit.changes[pathKey] = {
        type: ActionType.ADD,
        new_content: action.new_file ?? "",
      };
    } else if (action.type === ActionType.UPDATE) {
      const oldContent = orig[pathKey];
      if (oldContent === undefined) {
         // Should not happen if identify_files_needed works
         continue;
      }
      const newContent = _get_updated_file(oldContent, action, pathKey);
      commit.changes[pathKey] = {
        type: ActionType.UPDATE,
        old_content: oldContent,
        new_content: newContent,
        move_path: action.move_path ?? undefined,
      };
    }
  }
  return commit;
}

// -----------------------------------------------------------------------------
// Filesystem helpers for Node environment
// -----------------------------------------------------------------------------

export function load_files(
  paths: Array<string>,
  openFn: (p: string) => string,
): Record<string, string> {
  const orig: Record<string, string> = {};
  for (const p of paths) {
    try {
      orig[p] = openFn(p);
    } catch {
      // If the file is not found, treat it as empty. This allows models to
      // use "Update File" even for files that do not exist yet (which is a
      // common hallucination/behavior).
      orig[p] = "";
    }
  }
  return orig;
}

// FIXED: Atomic commit with rollback support

export interface CommitResult {
  success: boolean;
  appliedChanges: Array<string>;
  failedChange?: string;
  error?: string;
  backups: Record<string, string | null>; // path -> backup content (null if file didn't exist)
}

export function apply_commit_atomic(
  commit: Commit,
  writeFn: (p: string, c: string) => void,
  removeFn: (p: string) => void,
  readFn: (p: string) => string,
  mkdirFn?: (p: string) => void,
): CommitResult {
  const result: CommitResult = {
    success: false,
    appliedChanges: [],
    backups: {}
  };
  
  const changes = Object.entries(commit.changes);
  
  // Phase 1: Create backups and validate
  for (const [p, change] of changes) {
    try {
      if (change.type === ActionType.DELETE || change.type === ActionType.UPDATE) {
        // Backup existing file
        try {
          result.backups[p] = readFn(p);
        } catch {
          result.backups[p] = null; // File didn't exist
        }
      } else {
        result.backups[p] = null; // New file, no backup needed
      }
      
      // For moves, also backup/check destination
      if (change.type === ActionType.UPDATE && change.move_path) {
        const destDir = dirname(change.move_path);
        // Validate we can create destination directory
        if (mkdirFn && destDir !== ".") {
          try {
            mkdirFn(destDir);
          } catch (e) {
            result.error = `Cannot create directory for move: ${destDir} - ${e}`;
            result.failedChange = p;
            return result;
          }
        }
        
        // Check if destination exists (don't overwrite without backup)
        try {
          result.backups[change.move_path] = readFn(change.move_path);
        } catch {
          result.backups[change.move_path] = null;
        }
      }
    } catch (e) {
      result.error = `Failed to backup ${p}: ${e}`;
      result.failedChange = p;
      return result;
    }
  }
  
  // Phase 2: Apply changes
  for (const [p, change] of changes) {
    try {
      if (change.type === ActionType.DELETE) {
        removeFn(p);
      } else if (change.type === ActionType.ADD) {
        // Ensure directory exists for new files
        const dir = dirname(p);
        if (mkdirFn && dir !== ".") {
          mkdirFn(dir);
        }
        writeFn(p, change.new_content ?? "");
      } else if (change.type === ActionType.UPDATE) {
        if (change.move_path) {
          // Ensure destination directory exists
          const destDir = dirname(change.move_path);
          if (mkdirFn && destDir !== ".") {
            mkdirFn(destDir);
          }
          writeFn(change.move_path, change.new_content ?? "");
          removeFn(p);
        } else {
          writeFn(p, change.new_content ?? "");
        }
      }
      result.appliedChanges.push(p);
    } catch (e) {
      result.error = `Failed to apply change to ${p}: ${e}`;
      result.failedChange = p;
      
      // Phase 3: Rollback on failure
      rollback_commit(result.backups, writeFn, removeFn);
      return result;
    }
  }
  
  result.success = true;
  return result;
}

function rollback_commit(
  backups: Record<string, string | null>,
  writeFn: (p: string, c: string) => void,
  removeFn: (p: string) => void,
): void {
  for (const [path, content] of Object.entries(backups)) {
    try {
      if (content === null) {
        // File didn't exist originally, remove it
        removeFn(path);
      } else {
        // Restore original content
        writeFn(path, content);
      }
    } catch (e) {
      // Log rollback failure but continue trying to restore other files
      console.error(`Rollback failed for ${path}: ${e}`);
    }
  }
}

// Keep old function for backward compatibility, but delegate to atomic version
export function apply_commit(
  commit: Commit,
  writeFn: (p: string, c: string) => void,
  removeFn: (p: string) => void,
  readFn?: (p: string) => string,
  mkdirFn?: (p: string) => void,
): void {
  if (!readFn) {
    // Fallback to non-atomic version if no readFn provided
    for (const [p, change] of Object.entries(commit.changes)) {
      if (change.type === ActionType.DELETE) {
        removeFn(p);
      } else if (change.type === ActionType.ADD) {
        writeFn(p, change.new_content ?? "");
      } else if (change.type === ActionType.UPDATE) {
        if (change.move_path) {
          writeFn(change.move_path, change.new_content ?? "");
          removeFn(p);
        } else {
          writeFn(p, change.new_content ?? "");
        }
      }
    }
    return;
  }
  
  const result = apply_commit_atomic(commit, writeFn, removeFn, readFn, mkdirFn);
  if (!result.success) {
    throw new DiffError(result.error || "Commit failed");
  }
}


// FIXED: Proper error handling and validation

export function process_patch(
  text: string,
  openFn: (p: string) => string,
  writeFn: (p: string, c: string) => void,
  removeFn: (p: string) => void,
  mkdirFn?: (p: string) => void,
): { success: boolean; message: string; details?: any } {
  try {
    const normalized = normalizePatchText(text);
    
    // Validate patch has content
    if (!normalized || normalized.trim().length === 0) {
      return { success: false, message: "Empty patch provided" };
    }
    
    const paths = identify_files_needed(normalized);
    const addedPaths = identify_files_added(normalized);
    
    // Check for conflicts (adding existing file)
    for (const path of addedPaths) {
      try {
        openFn(path);
        return { 
          success: false, 
          message: `Cannot add file '${path}' - it already exists. Use update instead.` 
        };
      } catch {
        // File doesn't exist, good
      }
    }
    
    const orig = load_files(paths, openFn);
    
    let patch: Patch;
    let fuzz: number;
    try {
      [patch, fuzz] = text_to_patch(normalized, orig);
    } catch (e) {
      if (e instanceof DiffError) {
        return { 
          success: false, 
          message: `Patch parse error: ${e.message}`,
          details: { error: e.message }
        };
      }
      throw e;
    }
    
    const commit = patch_to_commit(patch, orig);
    
    // Apply atomically with rollback support
    const result = apply_commit_atomic(
      commit, 
      writeFn, 
      removeFn, 
      openFn,
      mkdirFn
    );
    
    if (!result.success) {
      return {
        success: false,
        message: `Failed to apply patch: ${result.error}`,
        details: {
          failedFile: result.failedChange,
          appliedFiles: result.appliedChanges,
          fuzz
        }
      };
    }
    
    return {
      success: true,
      message: `Successfully applied patch with ${result.appliedChanges.length} change(s)${fuzz > 0 ? ` (fuzz: ${fuzz})` : ""}`,
      details: {
        changedFiles: result.appliedChanges,
        backups: result.backups,
        fuzz
      }
    };
  } catch (err) {
    return {
      success: false,
      message: `Unexpected error: ${err instanceof Error ? err.message : String(err)}`,
      details: { error: String(err) }
    };
  }
}