import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.mjs";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, readdirSync } from "fs";
import { join, resolve, dirname } from "path";
import { homedir } from "os";
import { handleExecCommand } from "./handle-exec-command.js";
import type { AgentContext } from "./types.js";
import { getIgnoreFilter } from "./ignore-utils.js";
import { validateFileSyntax } from "./validate-file.js";
import { log } from "./log.js";
import { applyEdits, formatStyledDiff } from "./edit-file.js";
import { extractSymbols } from "./symbol-extractor.js";
import { runProjectDiagnostics } from "./diagnostics.js";
import { createCheckpoint } from "./checkpoint.js";

import { unlinkSync, renameSync } from 'fs'

function findGitRoot(startDir: string): string | null {
  let dir = resolve(startDir);
  while (true) {
    if (existsSync(join(dir, ".git"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return null;
}

export async function handleReadFile(
  ctx: AgentContext,
  rawArgs: string,
): Promise<{
  outputText: string;
  metadata: Record<string, unknown>;
  additionalItems?: Array<ChatCompletionMessageParam>;
}> {
  try {
    const args = JSON.parse(rawArgs);
    const { path: filePath } = args;

    if (!filePath) {
      return {
        outputText: "Error: 'path' is required for read_file",
        metadata: { exit_code: 1 },
      };
    }

    const execResult = await handleExecCommand(
      { cmd: ["cat", filePath], workdir: process.cwd(), timeoutInMillis: 30000 },
      ctx.config,
      ctx.approvalPolicy,
      ctx.getCommandConfirmation,
      ctx.execAbortController?.signal,
    );

    if (execResult.outputText === "aborted") {
      return execResult;
    }

    const fullPath = join(process.cwd(), filePath);
    if (!existsSync(fullPath)) {
      return {
        outputText: `Error: File not found: ${filePath}`,
        metadata: { exit_code: 1 },
      };
    }

    ctx.onFileAccess?.(filePath);
    const content = readFileSync(fullPath, "utf-8");
    return {
      outputText: content,
      metadata: { exit_code: 0, path: filePath, size: content.length },
    };
  } catch (err) {
    return {
      outputText: `Error reading file: ${String(err)}`,
      metadata: { exit_code: 1 },
    };
  }
}

// FIXED: Ensure parent directories exist with proper error handling

export async function handleWriteFile(
  ctx: AgentContext,
  rawArgs: string,
): Promise<{
  outputText: string;
  metadata: Record<string, unknown>;
  additionalItems?: Array<ChatCompletionMessageParam>;
}> {
  try {
    const args = JSON.parse(rawArgs);
    const { path: filePath, content } = args;

    if (!filePath || content === undefined) {
      return {
        outputText: "Error: 'path' and 'content' are required for write_file",
        metadata: { exit_code: 1 },
      };
    }

    const execResult = await handleExecCommand(
      { cmd: ["write_file", filePath], workdir: process.cwd(), timeoutInMillis: 30000 },
      ctx.config,
      ctx.approvalPolicy,
      ctx.getCommandConfirmation,
      ctx.execAbortController?.signal,
    );

    if (execResult.outputText === "aborted") {
      return execResult;
    }

    if (ctx.config.dryRun) {
      return {
        outputText: `[Dry Run] Would write ${content.length} characters to ${filePath}`,
        metadata: { exit_code: 0, path: filePath, dry_run: true },
      };
    }

    const fullPath = join(process.cwd(), filePath);
    const parentDir = dirname(fullPath);
    
    // FIXED: Proper directory creation with error handling
    if (!existsSync(parentDir)) {
      try {
        mkdirSync(parentDir, { recursive: true });
      } catch (e) {
        return {
          outputText: `Error: Failed to create directory '${parentDir}': ${e}`,
          metadata: { exit_code: 1, path: filePath },
        };
      }
    }

    ctx.onFileAccess?.(filePath);
    
    // Capture backup for /undo
    let backup: string | null = null;
    try {
      if (existsSync(fullPath)) {
        backup = readFileSync(fullPath, "utf-8");
      }
    } catch { /* ignore */ }

    // FIXED: Atomic write using temp file + rename
    const tempPath = `${fullPath}.tmp.${Date.now()}`;
    try {
      writeFileSync(tempPath, content, "utf-8");
      
      // Validate syntax before committing
      const validation = await validateFileSyntax(tempPath);
      if (!validation.isValid) {
        // Clean up temp file
        try { unlinkSync(tempPath); } catch {}
        return {
          outputText: `Error: File contains syntax errors:\n${validation.error}`,
          metadata: { exit_code: 1, path: filePath, syntax_error: true },
        };
      }
      
      // Atomic rename
      renameSync(tempPath, fullPath);
    } catch (e) {
      // Clean up temp file on error
      try { unlinkSync(tempPath); } catch {}
      throw e;
    }

    return {
      outputText: `Successfully wrote ${content.length} characters to ${filePath}`,
      metadata: { exit_code: 0, path: filePath, backups: { [filePath]: backup } },
    };
  } catch (err) {
    return {
      outputText: `Error writing file: ${String(err)}`,
      metadata: { exit_code: 1 },
    };
  }
}

export async function handleEditFile(
  ctx: AgentContext,
  rawArgs: string,
): Promise<{
  outputText: string;
  metadata: Record<string, unknown>;
  additionalItems?: Array<ChatCompletionMessageParam>;
}> {
  try {
    const args = JSON.parse(rawArgs);
    const { path: filePath, edits } = args;

    if (!filePath || !edits || !Array.isArray(edits)) {
      return {
        outputText: "Error: 'path' and 'edits' (array) are required for edit_file",
        metadata: { exit_code: 1 },
      };
    }

    const fullPath = resolve(process.cwd(), filePath);
    if (!existsSync(fullPath)) {
      return {
        outputText: `Error: File not found: ${filePath}`,
        metadata: { exit_code: 1 },
      };
    }

    const editResult = applyEdits(fullPath, edits);
    if (!editResult.success) {
      return {
        outputText: `Error applying edits to ${filePath}: ${editResult.error}`,
        metadata: { exit_code: 1 },
      };
    }

    const { content: newContent, diff } = editResult;

    // Trigger confirmation with the diff
    const execResult = await handleExecCommand(
      { cmd: ["edit_file", filePath, diff!], workdir: process.cwd(), timeoutInMillis: 30000 },
      ctx.config,
      ctx.approvalPolicy,
      ctx.getCommandConfirmation,
      ctx.execAbortController?.signal,
    );

    if (execResult.outputText === "aborted") {
      return execResult;
    }

    if (ctx.config.dryRun) {
      return {
        outputText: `[Dry Run] Would apply edits to ${filePath}\n\n${formatStyledDiff(diff!)}`,
        metadata: { exit_code: 0, path: filePath, dry_run: true },
      };
    }

    ctx.onFileAccess?.(filePath);
    
    // Capture backup for /undo
    let backup: string | null = null;
    try {
      backup = readFileSync(fullPath, "utf-8");
    } catch { /* ignore */ }

    // Atomic write
    const tempPath = `${fullPath}.tmp.${Date.now()}`;
    try {
      writeFileSync(tempPath, newContent!, "utf-8");
      const validation = await validateFileSyntax(tempPath);
      if (!validation.isValid) {
        try { unlinkSync(tempPath); } catch {}
        return {
          outputText: `Error: Edits resulted in syntax errors in ${filePath}:\n${validation.error}`,
          metadata: { exit_code: 1, path: filePath, syntax_error: true },
        };
      }
      renameSync(tempPath, fullPath);
    } catch (e) {
      try { unlinkSync(tempPath); } catch {}
      throw e;
    }

    return {
      outputText: `Successfully applied edits to ${filePath}. Diff:\n\n${formatStyledDiff(diff!)}`,
      metadata: { exit_code: 0, path: filePath, backups: { [filePath]: backup } },
    };
  } catch (err) {
    return {
      outputText: `Error editing file: ${String(err)}`,
      metadata: { exit_code: 1 },
    };
  }
}

export async function handleReadSymbols(
  ctx: AgentContext,
  rawArgs: string,
): Promise<{
  outputText: string;
  metadata: Record<string, unknown>;
}> {
  try {
    const args = JSON.parse(rawArgs);
    const { path: filePath } = args;

    if (!filePath) {
      return {
        outputText: "Error: 'path' is required for read_symbols",
        metadata: { exit_code: 1 },
      };
    }

    const fullPath = resolve(process.cwd(), filePath);
    if (!existsSync(fullPath)) {
      return {
        outputText: `Error: File not found: ${filePath}`,
        metadata: { exit_code: 1 },
      };
    }

    ctx.onFileAccess?.(filePath);
    const symbols = extractSymbols(fullPath);
    
    return {
      outputText: symbols,
      metadata: { exit_code: 0, path: filePath, type: "read_symbols" },
    };
  } catch (err) {
    return {
      outputText: `Error reading symbols: ${String(err)}`,
      metadata: { exit_code: 1 },
    };
  }
}

export async function handleCheckpoint(
  ctx: AgentContext,
  rawArgs: string,
): Promise<{
  outputText: string;
  metadata: Record<string, unknown>;
}> {
  try {
    const args = JSON.parse(rawArgs);
    const { name } = args;

    if (!name) {
      return {
        outputText: "Error: 'name' is required for checkpoint",
        metadata: { exit_code: 1 },
      };
    }

    const result = await createCheckpoint(ctx, name);
    return {
      outputText: result.output,
      metadata: { 
        exit_code: result.success ? 0 : 1, 
        checkpoint_name: result.name,
        type: "checkpoint" 
      },
    };
  } catch (err) {
    return {
      outputText: `Error creating checkpoint: ${String(err)}`,
      metadata: { exit_code: 1 },
    };
  }
}

export async function handleUpdateTasks(
  ctx: AgentContext,
  rawArgs: string,
): Promise<{
  outputText: string;
  metadata: Record<string, unknown>;
}> {
  try {
    const args = JSON.parse(rawArgs);
    const { tasks } = args;

    if (!tasks || !Array.isArray(tasks)) {
      return {
        outputText: "Error: 'tasks' array is required for update_tasks",
        metadata: { exit_code: 1 },
      };
    }

    ctx.onTasksUpdate?.(tasks);
    
    return {
      outputText: `Task list updated: ${tasks.length} tasks recorded.`,
      metadata: { exit_code: 0, task_count: tasks.length, type: "update_tasks" },
    };
  } catch (err) {
    return {
      outputText: `Error updating tasks: ${String(err)}`,
      metadata: { exit_code: 1 },
    };
  }
}

export async function handleRunDiagnostics(
  ctx: AgentContext,
): Promise<{
  outputText: string;
  metadata: Record<string, unknown>;
}> {
  try {
    const result = await runProjectDiagnostics(ctx);
    return {
      outputText: result.output,
      metadata: { 
        exit_code: result.success ? 0 : 1, 
        project_type: result.projectType,
        type: "run_diagnostics" 
      },
    };
  } catch (err) {
    return {
      outputText: `Error running diagnostics: ${String(err)}`,
      metadata: { exit_code: 1 },
    };
  }
}

export async function handleSearchSymbols(
  ctx: AgentContext,
  rawArgs: string,
): Promise<{
  outputText: string;
  metadata: Record<string, unknown>;
}> {
  try {
    const args = JSON.parse(rawArgs);
    const { query, limit = 5 } = args;

    if (!query) {
      return {
        outputText: "Error: 'query' is required for search_symbols",
        metadata: { exit_code: 1 },
      };
    }

    const agent = ctx.agent;
    if (!agent) {
       return { outputText: "Error: Agent not initialized", metadata: { exit_code: 1 } };
    }

    // Access semanticMemory from AgentLoop (it's private, so we need a public accessor or use cast)
    const semanticMemory = (agent as any).semanticMemory;
    if (!semanticMemory) {
       return { outputText: "Error: Semantic memory not available", metadata: { exit_code: 1 } };
    }

    const results = await semanticMemory.searchSymbols(query, limit);
    
    if (results.length === 0) {
      return { outputText: "No relevant symbol definitions found. Try a broader search or verify the codebase is indexed.", metadata: { exit_code: 0 } };
    }

    const outputText = results.map((r: any) => `File: ${r.path}\nContent snippet:\n${r.content}`).join("\n\n---\n\n");

    return {
      outputText,
      metadata: { exit_code: 0, query, match_count: results.length },
    };
  } catch (err) {
    return {
      outputText: `Error performing symbol search: ${String(err)}`,
      metadata: { exit_code: 1 },
    };
  }
}


export async function handleDeleteFile(
  ctx: AgentContext,
  rawArgs: string,
): Promise<{
  outputText: string;
  metadata: Record<string, unknown>;
  additionalItems?: Array<ChatCompletionMessageParam>;
}> {
  try {
    const args = JSON.parse(rawArgs);
    const { path: filePath } = args;

    if (!filePath) {
      return {
        outputText: "Error: 'path' is required for delete_file",
        metadata: { exit_code: 1 },
      };
    }

    const execResult = await handleExecCommand(
      { cmd: ["rm", filePath], workdir: process.cwd(), timeoutInMillis: 30000 },
      ctx.config,
      ctx.approvalPolicy,
      ctx.getCommandConfirmation,
      ctx.execAbortController?.signal,
    );

    if (execResult.outputText === "aborted") {
      return execResult;
    }

    if (ctx.config.dryRun) {
      return {
        outputText: `[Dry Run] Would delete file: ${filePath}`,
        metadata: { exit_code: 0, path: filePath, dry_run: true },
      };
    }

    const fullPath = join(process.cwd(), filePath);
    if (!existsSync(fullPath)) {
      return {
        outputText: `Error: File not found: ${filePath}`,
        metadata: { exit_code: 1 },
      };
    }

    ctx.onFileAccess?.(filePath);
    
    // Capture backup for /undo
    let backup: string | null = null;
    try {
      backup = readFileSync(fullPath, "utf-8");
    } catch { /* ignore */ }

    const fs = await import("fs");
    fs.unlinkSync(fullPath);
    return {
      outputText: `Successfully deleted ${filePath}`,
      metadata: { exit_code: 0, path: filePath, backups: { [filePath]: backup } },
    };
  } catch (err) {
    return {
      outputText: `Error deleting file: ${String(err)}`,
      metadata: { exit_code: 1 },
    };
  }
}

export async function handleListDirectory(
  ctx: AgentContext,
  rawArgs: string,
): Promise<{
  outputText: string;
  metadata: Record<string, unknown>;
  additionalItems?: Array<ChatCompletionMessageParam>;
}> {
  try {
    const args = JSON.parse(rawArgs);
    const { path: dirPath = "." } = args;

    const execResult = await handleExecCommand(
      { cmd: ["ls", dirPath], workdir: process.cwd(), timeoutInMillis: 30000 },
      ctx.config,
      ctx.approvalPolicy,
      ctx.getCommandConfirmation,
      ctx.execAbortController?.signal,
    );

    if (execResult.outputText === "aborted") {
      return execResult;
    }

    const fullPath = join(process.cwd(), dirPath);
    if (!existsSync(fullPath)) {
      return {
        outputText: `Error: Directory not found: ${dirPath}`,
        metadata: { exit_code: 1 },
      };
    }

    const ig = getIgnoreFilter();
    const entries = readdirSync(fullPath, { withFileTypes: true })
      .filter((e) => {
        const relPath = join(dirPath, e.name);
        const posixPath = relPath.replace(/\\/g, "/");
        return !ig.ignores(posixPath);
      })
      .sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      });

    const resultText = entries
      .map(e => `${e.isDirectory() ? "dir: " : "file:"} ${e.name}`)
      .join("\n");

    return {
      outputText: resultText || "Directory is empty.",
      metadata: { exit_code: 0, path: dirPath, count: entries.length },
    };
  } catch (err) {
    return {
      outputText: `Error listing directory: ${String(err)}`,
      metadata: { exit_code: 1 },
    };
  }
}

export async function handleSearchCodebase(
  ctx: AgentContext,
  rawArgs: string,
): Promise<{
  outputText: string;
  metadata: Record<string, unknown>;
  additionalItems?: Array<ChatCompletionMessageParam>;
}> {
  try {
    const args = JSON.parse(rawArgs);
    let pattern = args.pattern;
    let include = args.include;
    const query = args.query;

    // Heuristic: If 'query' is present and 'pattern' looks like a glob (e.g. *.ts),
    // and 'include' is missing, assume the user confused the parameters.
    if (query && pattern && !include) {
      if (pattern?.trim().startsWith("*") || /\.[a-zA-Z0-9]+$/.test(pattern)) {
        include = pattern;
        pattern = query;
      }
    }

    // Fallback: Use query as pattern if pattern is missing
    if (!pattern && query) {
      pattern = query;
    }

    const { path: searchPath } = args;

    if (!pattern) {
      return {
        outputText: "Error: 'pattern' or 'query' is required for search_codebase",
        metadata: { exit_code: 1 },
      };
    }

    // Heuristic: If pattern starts with '*' and no query is provided, assume File Listing Mode
    // e.g. search_codebase({ pattern: "*.json" }) -> list all json files
    const isFileListingMode = !query && pattern.trim().startsWith("*");

    const rgArgs = isFileListingMode 
      ? ["rg", "--files", "-g", pattern] 
      : ["rg", "--json", pattern];

    if (searchPath) {
      rgArgs.push(searchPath);
    }
    if (include) {
      // Split by spaces and add each glob separately with -g
      const globs = include.split(/\s+/).filter(Boolean);
      for (const glob of globs) {
        rgArgs.push("-g", glob);
      }
    }

    // Add .codexignore support to ripgrep
    const gitRoot = findGitRoot(process.cwd());
    const searchDirs = [process.cwd()];
    if (gitRoot && gitRoot !== process.cwd()) searchDirs.push(gitRoot);
    searchDirs.push(join(homedir(), ".codex"));

    for (const dir of searchDirs) {
      const codexIgnorePath = join(dir, ".codexignore");
      if (existsSync(codexIgnorePath)) {
        rgArgs.push("--ignore-file", codexIgnorePath);
      }
    }

    const resultPromise = handleExecCommand(
      {
        cmd: rgArgs,
        workdir: process.cwd(),
        timeoutInMillis: 30000,
      },
      ctx.config,
      ctx.approvalPolicy,
      ctx.getCommandConfirmation,
      ctx.execAbortController?.signal,
    );

    // Hybrid Search: Run semantic search in parallel if available
    let semanticResults: any[] = [];
    if (ctx.agent && ctx.agent.hasIndex() && !isFileListingMode && !searchPath) {
      // Only run semantic search for global searches (no specific path) for now to avoid noise
      try {
        semanticResults = await ctx.agent.searchCode(query || pattern, 5);
      } catch (e) {
        if (process.env["DEBUG"]) log(`Semantic search failed during hybrid search: ${e}`);
      }
    }

    const result = await resultPromise;

    if (result.outputText === "aborted") {
      return result;
    }

    const { outputText, metadata } = result;

    if (isFileListingMode) {
      const fileList = outputText?.trim();
      return {
        outputText: fileList || "No files found matching the pattern.",
        metadata: { ...metadata, match_count: fileList ? fileList.split('\n').length : 0, mode: "file_listing" }
      };
    }

    // Process ripgrep JSON output to be more compact/useful for the model
    const lines = outputText.trim().split("\n");
    const results: Array<any> = [];
    const seenFiles = new Set<string>();

    for (const line of lines) {
      if (!line) continue;
      try {
        const parsed = JSON.parse(line);
        if (parsed.type === "match") {
          const filePath = parsed.data.path.text;
          seenFiles.add(filePath);
          results.push({
            file: filePath,
            line: parsed.data.line_number,
            text: parsed.data.lines.text.trim(),
            source: "keyword"
          });
        }
      } catch {
        // Skip invalid JSON lines
      }
    }

    // Merge semantic results
    for (const sem of semanticResults) {
      // If we haven't seen this file in exact matches, add it
      // Or maybe we add it anyway? Let's add if not seen to provide "new" context.
      if (!seenFiles.has(sem.path)) {
        results.push({
          file: sem.path,
          line: 0, // Semantic search often gives chunks, not exact lines. 0 indicates general relevance.
          text: `[Semantic Match] ${sem.content.slice(0, 200).replace(/\n/g, " ")}...`,
          source: "semantic"
        });
      }
    }

    if (results.length === 0 && metadata["exit_code"] !== 0 && metadata["exit_code"] !== 1) {
      return {
        outputText: `Error: search_codebase failed with exit code ${metadata["exit_code"]}. ${outputText.trim() || "Check if 'rg' (ripgrep) is installed."}`,
        metadata,
      };
    }

    // Sort results: Keyword matches first, then semantic
    // results.sort((a, b) => (a.source === "keyword" ? -1 : 1)); 
    // Actually, preserving order might be better or sorting by file.
    // Let's just group by file for readability.
    
    // Group by file
    const grouped: Record<string, any[]> = {};
    for (const r of results) {
      if (!grouped[r.file]) grouped[r.file] = [];
      grouped[r.file]!.push(r);
    }

    let finalOutput = "";
    for (const [file, matches] of Object.entries(grouped)) {
      finalOutput += `File: ${file}\n`;
      for (const m of matches) {
        if (m.source === "semantic") {
           finalOutput += `  (Semantic) ${m.text}\n`;
        } else {
           finalOutput += `  ${m.line}: ${m.text}\n`;
        }
      }
      finalOutput += "\n";
    }

    return {
      outputText: finalOutput.trim() || "No matches found.",
      metadata: { ...metadata, match_count: results.length, hybrid: semanticResults.length > 0 },
    };
  } catch (err) {
    return {
      outputText: `Error executing search: ${String(err)}`,
      metadata: { exit_code: 1 },
    };
  }
}

export async function handlePersistentMemory(
  ctx: AgentContext,
  rawArgs: string,
): Promise<{
  outputText: string;
  metadata: Record<string, unknown>;
  additionalItems?: Array<ChatCompletionMessageParam>;
}> {
  try {
    const args = JSON.parse(rawArgs);
    const { fact, category = "general" } = args;

    if (!fact) {
      return {
        outputText: "Error: 'fact' is required for persistent_memory",
        metadata: { exit_code: 1 },
      };
    }

    const entry = `[${category}] ${fact}`;
    const result = await handleExecCommand(
      { cmd: ["persistent_memory", entry], workdir: process.cwd(), timeoutInMillis: 30000 },
      ctx.config,
      ctx.approvalPolicy,
      ctx.getCommandConfirmation,
      ctx.execAbortController?.signal,
    );

    if (result.outputText === "aborted") {
      return result;
    }

    if (ctx.config.dryRun) {
      return {
        outputText: `[Dry Run] Would save fact: ${entry}`,
        metadata: { exit_code: 0, dry_run: true },
      };
    }

    const memoryDir = join(process.cwd(), ".codex");
    const memoryPath = join(memoryDir, "memory.md");

    if (!existsSync(memoryDir)) {
      mkdirSync(memoryDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().split("T")[0];
    const fullEntry = `\n- [${timestamp}] [${category}] ${fact}`;
    appendFileSync(memoryPath, fullEntry, "utf-8");

    return {
      outputText: `Fact saved to ${category}: ${fact}`,
      metadata: { exit_code: 0, path: memoryPath, category },
    };
  } catch (err) {
    return {
      outputText: `Error saving memory: ${String(err)}`,
      metadata: { exit_code: 1 },
    };
  }
}

export async function handleSummarizeMemory(): Promise<{
  outputText: string;
  metadata: Record<string, unknown>;
}> {
  try {
    const memoryPath = join(process.cwd(), ".codex", "memory.md");
    if (!existsSync(memoryPath)) {
      return {
        outputText: "No memory file found to summarize.",
        metadata: { exit_code: 0 },
      };
    }

    const content = readFileSync(memoryPath, "utf-8");
    return {
      outputText: `Current Memory Contents:\n${content}\n\nPlease review and let me know if you want to consolidate or remove any outdated facts.`,
      metadata: { exit_code: 0, length: content.length },
    };
  } catch (err) {
    return {
      outputText: `Error summarizing memory: ${String(err)}`,
      metadata: { exit_code: 1 },
    };
  }
}

export async function handleQueryMemory(
  rawArgs: string,
): Promise<{
  outputText: string;
  metadata: Record<string, unknown>;
}> {
  try {
    const args = JSON.parse(rawArgs);
    const { query } = args;
    if (!query) {
      return { outputText: "Error: 'query' is required", metadata: { exit_code: 1 } };
    }

    const memoryPath = join(process.cwd(), ".codex", "memory.md");
    if (!existsSync(memoryPath)) {
      return { outputText: "No memory file found.", metadata: { exit_code: 0 } };
    }

    const content = readFileSync(memoryPath, "utf-8");
    const lines = content.split("\n");
    const matches = lines.filter((line) => line.toLowerCase().includes(query.toLowerCase()));

    return {
      outputText: matches.length > 0 ? `Matching memory entries:\n${matches.join("\n")}` : "No matching memory entries found.",
      metadata: { exit_code: 0, match_count: matches.length },
    };
  } catch (err) {
    return { outputText: `Error querying memory: ${String(err)}`, metadata: { exit_code: 1 } };
  }
}

export async function handleForgetMemory(
  rawArgs: string,
): Promise<{
  outputText: string;
  metadata: Record<string, unknown>;
}> {
  try {
    const args = JSON.parse(rawArgs);
    const { pattern } = args;
    if (!pattern) {
      return { outputText: "Error: 'pattern' is required", metadata: { exit_code: 1 } };
    }

    const memoryPath = join(process.cwd(), ".codex", "memory.md");
    if (!existsSync(memoryPath)) {
      return { outputText: "No memory file found.", metadata: { exit_code: 0 } };
    }

    const content = readFileSync(memoryPath, "utf-8");
    const lines = content.split("\n");
    const nextLines = lines.filter((line) => !line.toLowerCase().includes(pattern.toLowerCase()));

    if (lines.length === nextLines.length) {
      return { outputText: `No entries matched "${pattern}".`, metadata: { exit_code: 0, removed_count: 0 } };
    }

    writeFileSync(memoryPath, nextLines.join("\n"), "utf-8");
    return {
      outputText: `Successfully removed ${lines.length - nextLines.length} entry(ies) matching "${pattern}".`,
      metadata: { exit_code: 0, removed_count: lines.length - nextLines.length },
    };
  } catch (err) {
    return { outputText: `Error updating memory: ${String(err)}`, metadata: { exit_code: 1 } };
  }
}

export async function handleMaintainMemory(
  ctx: AgentContext,
): Promise<{
  outputText: string;
  metadata: Record<string, unknown>;
}> {
  try {
    const memoryPath = join(process.cwd(), ".codex", "memory.md");
    if (!existsSync(memoryPath)) {
      return { outputText: "No memory file found to maintain.", metadata: { exit_code: 0 } };
    }

    const content = readFileSync(memoryPath, "utf-8");
    if (content.trim().length === 0) {
      return { outputText: "Memory is empty, nothing to maintain.", metadata: { exit_code: 0 } };
    }

    const maintenancePrompt = `
You are a project memory maintenance assistant. Your task is to review the following list of project facts and perform "garbage collection".

RULES:
1. Identify and MERGE duplicate facts.
2. Resolve CONTRADICTIONS (if any, keep the most recent or more detailed one).
3. REMOVE outdated or redundant information.
4. MAINTAIN the format: - [timestamp] [category] fact
5. Ensure categories are consistent.
6. Return ONLY the cleaned-up list of facts, one per line. If no changes are needed, return the original list.

CURRENT MEMORY ENTRIES:
${content}
`;

    if (process.env["DEBUG"] === "1") {
      log(`[HTTP] Request: POST ${ctx.oai.baseURL}/chat/completions (Maintenance)`);
      log(`[HTTP] Model: ${ctx.model}, Messages: 1`);
    }

    const response = await ctx.oai.chat.completions.create({
      model: ctx.model,
      messages: [{ role: "user", content: maintenancePrompt }],
    });

    if (process.env["DEBUG"] === "1") {
      log(`[HTTP] Response: Maintenance complete`);
    }

    const cleanedContent = response.choices[0]?.message?.content?.trim();
    if (cleanedContent && cleanedContent !== content) {
      writeFileSync(memoryPath, cleanedContent, "utf-8");
      return {
        outputText: `Memory maintenance complete. Memory has been cleaned up and consolidated.`,
        metadata: { exit_code: 0, original_size: content.length, new_size: cleanedContent.length },
      };
    }

    return {
      outputText: "Memory maintenance complete. No changes were necessary.",
      metadata: { exit_code: 0 },
    };
  } catch (err) {
    return { outputText: `Error during memory maintenance: ${String(err)}`, metadata: { exit_code: 1 } };
  }
}

export async function handleReadFileLines(
  ctx: AgentContext,
  rawArgs: string,
): Promise<{
  outputText: string;
  metadata: Record<string, unknown>;
  additionalItems?: Array<ChatCompletionMessageParam>;
}> {
  try {
    const args = JSON.parse(rawArgs);
    const filePath = args.path;
    const start_line = args.start_line ?? args.start ?? args.line_start;
    const end_line = args.end_line ?? args.end ?? args.line_end;

    if (!filePath || start_line === undefined || end_line === undefined) {
      return {
        outputText:
          "Error: 'path', 'start_line', and 'end_line' are required for read_file_lines",
        metadata: { exit_code: 1 },
      };
    }

    const result = await handleExecCommand(
      { cmd: ["cat", filePath, `lines ${start_line}-${end_line}`], workdir: process.cwd(), timeoutInMillis: 30000 },
      ctx.config,
      ctx.approvalPolicy,
      ctx.getCommandConfirmation,
      ctx.execAbortController?.signal,
    );

    if (result.outputText === "aborted") {
      return result;
    }

    const fullPath = join(process.cwd(), filePath);
    if (!existsSync(fullPath)) {
      return {
        outputText: `Error: File not found: ${filePath}`,
        metadata: { exit_code: 1 },
      };
    }

    ctx.onFileAccess?.(filePath);
    const content = readFileSync(fullPath, "utf-8");
    const lines = content.split("\n");
    
    const start = Math.max(0, start_line - 1);
    const end = Math.min(lines.length, end_line);
    
    const requestedLines = lines.slice(start, end);
    const resultText = requestedLines.join("\n");

    return {
      outputText: resultText,
      metadata: {
        exit_code: 0,
        start_line: start + 1,
        end_line: end,
        total_lines: lines.length,
      },
    };
  } catch (err) {
    return {
      outputText: `Error reading file lines: ${String(err)}`,
      metadata: { exit_code: 1 },
    };
  }
}

export async function handleListFilesRecursive(
  ctx: AgentContext,
  rawArgs: string,
): Promise<{
  outputText: string;
  metadata: Record<string, unknown>;
  additionalItems?: Array<ChatCompletionMessageParam>;
}> {
  try {
    const args = JSON.parse(rawArgs);
    const { path: startPath = ".", depth = 3 } = args;

    const result = await handleExecCommand(
      { cmd: ["ls", "-R", startPath], workdir: process.cwd(), timeoutInMillis: 30000 },
      ctx.config,
      ctx.approvalPolicy,
      ctx.getCommandConfirmation,
      ctx.execAbortController?.signal,
    );

    if (result.outputText === "aborted") {
      return result;
    }

    const fullStartPath = join(process.cwd(), startPath);
    if (!existsSync(fullStartPath)) {
      return {
        outputText: `Error: Path not found: ${startPath}`,
        metadata: { exit_code: 1 },
      };
    }

    const ig = getIgnoreFilter();
    const generateTree = async (
      dir: string,
      currentDepth: number,
      currentRelPath: string = "",
    ): Promise<string> => {
      if (currentDepth > depth) return "";

      let dirents: Array<import("fs").Dirent> = [];
      try {
        dirents = readdirSync(dir, { withFileTypes: true });
      } catch {
        return "";
      }

      const entries = dirents
        .filter((e) => {
          const relPath = join(currentRelPath, e.name);
          const posixPath = relPath.replace(/\\/g, "/");
          return !ig.ignores(posixPath);
        })
        .sort((a, b) => {
          if (a.isDirectory() && !b.isDirectory()) return -1;
          if (!a.isDirectory() && b.isDirectory()) return 1;
          return a.name.localeCompare(b.name);
        });

      const results = await Promise.all(
        entries.map(async (entry) => {
          const indent = "  ".repeat(currentDepth - 1);
          const relPath = join(currentRelPath, entry.name);
          if (entry.isDirectory()) {
            let subtree = `${indent}dir: ${entry.name}/\n`;
            subtree += await generateTree(join(dir, entry.name), currentDepth + 1, relPath);
            return subtree;
          } else {
            return `${indent}file: ${entry.name}\n`;
          }
        }),
      );

      return results.join("");
    };

    const treeResult = await generateTree(fullStartPath, 1, startPath === "." ? "" : startPath);

    return {
      outputText: treeResult || "No files found.",
      metadata: { exit_code: 0, path: startPath, depth },
    };
  } catch (err) {
    return {
      outputText: `Error listing files: ${String(err)}`,
      metadata: { exit_code: 1 },
    };
  }
}

export async function handleFetchUrl(
  ctx: AgentContext,
  rawArgs: string,
): Promise<{
  outputText: string;
  metadata: Record<string, unknown>;
}> {
  try {
    const args = JSON.parse(rawArgs);
    const { url } = args;

    if (!url) {
      return {
        outputText: "Error: 'url' is required for fetch_url",
        metadata: { exit_code: 1 },
      };
    }

    const execResult = await handleExecCommand(
      { cmd: ["lynx", "-dump", url], workdir: process.cwd(), timeoutInMillis: 30000 },
      ctx.config,
      ctx.approvalPolicy,
      ctx.getCommandConfirmation,
      ctx.execAbortController?.signal,
    );

    return {
      ...execResult,
      metadata: { ...execResult.metadata, url, type: "web_fetch" },
    };
  } catch (err) {
    return {
      outputText: `Error fetching URL: ${String(err)}`,
      metadata: { exit_code: 1 },
    };
  }
}

export async function handleWebSearch(
  ctx: AgentContext,
  rawArgs: string,
): Promise<{
  outputText: string;
  metadata: Record<string, unknown>;
}> {
  try {
    const args = JSON.parse(rawArgs);
    const { query } = args;

    if (!query) {
      return {
        outputText: "Error: 'query' is required for web_search",
        metadata: { exit_code: 1 },
      };
    }

    // Use DuckDuckGo HTML version for better parsing with lynx
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

    const execResult = await handleExecCommand(
      { cmd: ["lynx", "-dump", searchUrl], workdir: process.cwd(), timeoutInMillis: 30000 },
      ctx.config,
      ctx.approvalPolicy,
      ctx.getCommandConfirmation,
      ctx.execAbortController?.signal,
    );

    return {
      ...execResult,
      metadata: { ...execResult.metadata, query, type: "web_search" },
    };
  } catch (err) {
    return {
      outputText: `Error performing web search: ${String(err)}`,
      metadata: { exit_code: 1 },
    };
  }
}

export async function handleSemanticSearch(
  ctx: AgentContext,
  rawArgs: string,
): Promise<{
  outputText: string;
  metadata: Record<string, unknown>;
}> {
  try {
    const args = JSON.parse(rawArgs);
    const { query, limit = 5 } = args;

    if (!query) {
      return {
        outputText: "Error: 'query' is required for semantic_search",
        metadata: { exit_code: 1 },
      };
    }

    if (process.env["DEBUG"] === "1") {
      log(`Semantic search query: "${query}" (limit: ${limit})`);
    }

    const agent = ctx.agent;
    if (!agent) {
       return { outputText: "Error: Agent not initialized", metadata: { exit_code: 1 } };
    }

    const results = await agent.searchCode(query, limit);
    
    if (results.length === 0) {
      return { outputText: "No semantically relevant code found.", metadata: { exit_code: 0 } };
    }

    const outputText = results.map((r: any) => `File: ${r.path}\nContent snippet:\n${r.content}`).join("\n\n---\n\n");

    return {
      outputText,
      metadata: { exit_code: 0, query, match_count: results.length },
    };
  } catch (err) {
    return {
      outputText: `Error performing semantic search: ${String(err)}`,
      metadata: { exit_code: 1 },
    };
  }
}

export async function handleNpmSearch(
  ctx: AgentContext,
  rawArgs: string,
): Promise<{
  outputText: string;
  metadata: Record<string, unknown>;
}> {
  try {
    const args = JSON.parse(rawArgs);
    const { query, detailed = false } = args;

    if (!query) {
      return {
        outputText: "Error: 'query' is required for npm_search",
        metadata: { exit_code: 1 },
      };
    }

    const cmd = detailed 
      ? ["npm", "view", query, "--json"] 
      : ["npm", "search", query, "--json", "--limit", "10"];

    const result = await handleExecCommand(
      { cmd, workdir: process.cwd(), timeoutInMillis: 30000 },
      ctx.config,
      ctx.approvalPolicy,
      ctx.getCommandConfirmation,
      ctx.execAbortController?.signal,
    );

    if (result.outputText === "aborted") {
      return result;
    }

    // Process the output to be more readable if not already JSON
    let outputText = result.outputText;
    try {
      const parsed = JSON.parse(outputText);
      if (Array.isArray(parsed)) {
        // Format search results
        outputText = parsed.map((p: any) => `- ${p.name} (v${p.version}): ${p.description || "No description"}`).join("\n");
      } else if (detailed && parsed.name) {
        // Format detailed view
        outputText = `Package: ${parsed.name}\nLatest Version: ${parsed.version}\nDescription: ${parsed.description}\nDependencies: ${JSON.stringify(parsed.dependencies || {}, null, 2)}`;
      }
    } catch {
      // Keep original output if parsing fails
    }

    return {
      outputText: outputText || "No results found.",
      metadata: result.metadata,
    };
  } catch (err) {
    return {
      outputText: `Error performing npm search: ${String(err)}`,
      metadata: { exit_code: 1 },
    };
  }
}

export async function handleSnykSearch(
  ctx: AgentContext,
  rawArgs: string,
): Promise<{
  outputText: string;
  metadata: Record<string, unknown>;
}> {
  try {
    const args = JSON.parse(rawArgs);
    const { package: packageName } = args;

    if (!packageName) {
      return {
        outputText: "Error: 'package' is required for snyk_search",
        metadata: { exit_code: 1 },
      };
    }

    // Use direct search URL on security.snyk.io
    const searchUrl = `https://security.snyk.io/vuln/?search=${encodeURIComponent(packageName)}`;

    const execResult = await handleExecCommand(
      { cmd: ["lynx", "-dump", searchUrl], workdir: process.cwd(), timeoutInMillis: 30000 },
      ctx.config,
      ctx.approvalPolicy,
      ctx.getCommandConfirmation,
      ctx.execAbortController?.signal,
    );

    return {
      ...execResult,
      metadata: { ...execResult.metadata, package: packageName, type: "snyk_search" },
    };
  } catch (err) {
    return {
      outputText: `Error performing Snyk search: ${String(err)}`,
      metadata: { exit_code: 1 },
    };
  }
}
