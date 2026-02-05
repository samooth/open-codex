import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "fs";
import { join, dirname, relative } from "path";
import { log } from "./log.js";
import { getIgnoreFilter } from "./ignore-utils.js";

type EmbeddingCache = Record<string, number[]>;

interface VectorEntry {
  id: string;
  path: string;
  content: string;
  embedding: number[];
  mtime?: number;
}

export class SemanticMemory {
// ... existing private members ...
  private cache: EmbeddingCache = {};
  private cachePath: string;
  private memoryPath: string;
  private indexPath: string;
  private oai: OpenAI;
  private genAI?: GoogleGenAI;
  private entries: VectorEntry[] = [];
  private embeddingModel: string | undefined;

  constructor(oai: OpenAI, _provider: string = "openai", embeddingModel?: string, apiKey?: string) {
    this.oai = oai;
    this.embeddingModel = embeddingModel;
    if (_provider === "google" || _provider === "gemini") {
      this.genAI = new GoogleGenAI({ apiKey: apiKey || "" });
    }
    this.cachePath = join(process.cwd(), ".codex", "memory_embeddings.json");
    this.memoryPath = join(process.cwd(), ".codex", "memory.md");
    this.indexPath = join(process.cwd(), ".codex", "code_index.json");
    this.loadCache();
    this.loadIndex();
  }

  private loadCache() {
// ... existing loadCache ...
    if (existsSync(this.cachePath)) {
      try {
        this.cache = JSON.parse(readFileSync(this.cachePath, "utf-8"));
        if (process.env["DEBUG"] === "1") {
          log(`Loaded embedding cache: ${Object.keys(this.cache).length} entries`);
        }
      } catch {
        this.cache = {};
      }
    }
  }

  private loadIndex() {
// ... existing loadIndex ...
    if (existsSync(this.indexPath)) {
      try {
        this.entries = JSON.parse(readFileSync(this.indexPath, "utf-8"));
        if (process.env["DEBUG"] === "1") {
          log(`Loaded code index: ${this.entries.length} entries`);
        }
      } catch {
        this.entries = [];
      }
    }
  }

  public memoryExists(): boolean {
    return existsSync(this.memoryPath);
  }

  public hasIndex(): boolean {
    return this.entries.length > 0;
  }

  private saveCache() {
// ... existing saveCache ...
    try {
      const dir = dirname(this.cachePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(this.cachePath, JSON.stringify(this.cache), "utf-8");
    } catch (err) {
      log(`Failed to save semantic memory cache: ${String(err)}`);
    }
  }

  private saveIndex() {
// ... existing saveIndex ...
    try {
      const dir = dirname(this.indexPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      if (process.env["DEBUG"] === "1") {
        log(`Saving code index to ${this.indexPath} (${this.entries.length} entries)`);
      }
      writeFileSync(this.indexPath, JSON.stringify(this.entries), "utf-8");
    } catch (err) {
      log(`Failed to save code index: ${String(err)}`);
    }
  }

  private async getEmbedding(text: string): Promise<number[]> {
// ... existing getEmbedding ...
    if (this.cache[text]) {
      if (process.env["DEBUG"] === "1") {
        log(`    Embedding cache hit`);
      }
      return this.cache[text]!;
    }

    if (this.genAI) {
      const model = this.embeddingModel || "text-embedding-004";
      if (process.env["DEBUG"] === "1") {
        log(`    Fetching Google embedding for: "${text.slice(0, 50).replace(/\n/g, " ")}..."`);
        log(`    Model: ${model}`);
      }
      
      try {
        // Use the exact pattern provided: ai.models.embedContent({ model, contents: text })
        const result = await (this.genAI as any).models.embedContent({
          model,
          contents: text
        });
        
        // The user snippet logs result.embeddings. 
        // We'll extract the values from the first embedding in the list or the single embedding field.
        const embedding = result.embeddings?.[0]?.values || result.embedding?.values || (Array.isArray(result.embeddings) ? result.embeddings[0] : result.embeddings);
        
        if (!embedding) {
          throw new Error("No embedding values found in response");
        }
        
        this.cache[text] = embedding;
        this.saveCache();
        return embedding;
      } catch (err) {
        if (process.env["DEBUG"] === "1") {
          log(`    Google embedding failed: ${err}`);
        }
        throw err;
      }
    }

    const model = this.embeddingModel || "text-embedding-3-small";

    if (process.env["DEBUG"] === "1") {
      log(`    Fetching OpenAI embedding for: "${text.slice(0, 50).replace(/\n/g, " ")}..."`);
      log(`[HTTP] Request: POST ${this.oai.baseURL}/embeddings`);
      log(`[HTTP] Model: ${model}, Input length: ${text.length}`);
    }

    const response = await this.oai.embeddings.create({
      model,
      input: text,
    });

    if (process.env["DEBUG"] === "1") {
      log(`[HTTP] Response: Embedding generated`);
    }

    const embedding = response.data[0]!.embedding;
    this.cache[text] = embedding;
    this.saveCache();
    return embedding;
  }

  private cosineSimilarity(a: number[], b: number[]): number {
// ... existing cosineSimilarity ...
    let dotProduct = 0;
    let mA = 0;
    let mB = 0;
    for (let i = 0; i < a.length; i++) {
      const valA = a[i]!;
      const valB = b[i]!;
      dotProduct += valA * valB;
      mA += valA * valA;
      mB += valB * valB;
    }
    mA = Math.sqrt(mA);
    mB = Math.sqrt(mB);
    if (mA === 0 || mB === 0) return 0;
    return dotProduct / (mA * mB);
  }

  async findRelevant(query: string, limit: number = 5): Promise<string[]> {
// ... existing findRelevant ...
    if (!this.memoryExists()) return [];

    const content = readFileSync(this.memoryPath, "utf-8");
    const lines = content.split("\n").filter(l => l.trim().startsWith("- ["));
    if (lines.length === 0) return [];

    try {
      const queryEmbedding = await this.getEmbedding(query);
      
      const scored = await Promise.all(lines.map(async (line) => {
        try {
          const embedding = await this.getEmbedding(line);
          return { line, score: this.cosineSimilarity(queryEmbedding, embedding) };
        } catch {
          return { line, score: 0 };
        }
      }));

      const topResults = scored
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
      
      const relevant = topResults
        .filter(s => s.score > 0.1)
        .map(s => s.line);

      return relevant.length > 0 ? relevant : lines.slice(-limit);
    } catch (err) {
      log(`Semantic memory search failed: ${String(err)}`);
      return lines.slice(-limit);
    }
  }

  /**
   * Indexes the codebase for semantic search.
   */
  async indexCodebase(onProgress?: (current: number, total: number, file: string) => void): Promise<void> {
    const ig = getIgnoreFilter();
    const files: string[] = [];
    const root = process.cwd();

    if (process.env["DEBUG"] === "1") {
      log(`Starting codebase indexing in: ${root}`);
      log(`Traversing directory tree...`);
    }

    const traverse = (dir: string) => {
      let entries: any[] = [];
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch { return; }

      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        let relPath = relative(root, fullPath);
        
        // ignore library requires forward slashes and trailing slash for directories
        let posixPath = relPath.replace(/\\/g, "/");
        if (entry.isDirectory()) {
          posixPath += "/";
        }
        
        if (ig.ignores(posixPath)) {
          if (process.env["DEBUG"] === "1") {
            log(`    Ignoring: ${posixPath}`);
          }
          continue;
        }

        if (entry.isDirectory()) {
          traverse(fullPath);
        } else if (entry.isFile()) {
          if (/\.(ts|tsx|js|jsx|py|md|txt|go|rs|c|cpp|h|java|sh|yaml|json)$/i.test(entry.name)) {
            if (process.env["DEBUG"] === "1") {
              log(`    Found: ${posixPath}`);
            }
            files.push(fullPath);
          }
        }
      }
    };

    traverse(root);
    
    if (process.env["DEBUG"] === "1") {
      log(`Traversal complete. Found ${files.length} files to index.`);
    }

    const oldEntries = this.entries;
    this.entries = [];
    const total = files.length;
    
    for (let i = 0; i < files.length; i++) {
      const file = files[i]!;
      const relPath = relative(root, file);
      onProgress?.(i + 1, total, relPath);

      if (process.env["DEBUG"] === "1") {
        log(`Indexing [${i + 1}/${total}]: ${relPath}`);
      }

      try {
        const stats = statSync(file);
        const mtime = stats.mtimeMs;

        // Check if we can reuse existing entries for this file
        const matchingOldEntries = oldEntries.filter(e => e.path === relPath);
        if (matchingOldEntries.length > 0 && matchingOldEntries[0]?.mtime === mtime) {
          if (process.env["DEBUG"] === "1") {
            log(`  Skipping unchanged file: ${relPath}`);
          }
          this.entries.push(...matchingOldEntries);
          continue;
        }

        const content = readFileSync(file, "utf-8");
        if (!content.trim()) continue;

        const chunkSize = 1000;
        const overlap = 200;
        const chunks: string[] = [];
        
        for (let j = 0; j < content.length; j += (chunkSize - overlap)) {
          chunks.push(content.slice(j, j + chunkSize));
          if (chunks.length > 50) break; 
        }

        for (let k = 0; k < chunks.length; k++) {
          const chunk = chunks[k]!;
          const textToEmbed = `File: ${relPath}\n\n${chunk}`;
          
          if (process.env["DEBUG"] === "1") {
            log(`  Embedding chunk ${k + 1}/${chunks.length} (${chunk.length} chars)`);
          }

          try {
            const embedding = await this.getEmbedding(textToEmbed);
            
            this.entries.push({
              id: `${relPath}#${k}`,
              path: relPath,
              content: chunk,
              embedding: embedding,
              mtime: mtime
            });
          } catch (chunkErr) {
            log(`    Failed to embed chunk ${k} of ${relPath}: ${String(chunkErr)}`);
          }
        }
      } catch (err) {
        log(`Failed to index file ${file}: ${String(err)}`);
      }
    }

    this.saveIndex();

    if (process.env["DEBUG"] === "1") {
      log(`Codebase indexing complete. Total entries: ${this.entries.length}`);
    }
  }

  async search(query: string, limit: number = 5): Promise<any[]> {
// ... existing search ...
    if (this.entries.length === 0) return [];
    
    try {
      const queryEmbedding = await this.getEmbedding(query);
      
      const scored = this.entries.map(entry => ({
        ...entry,
        score: this.cosineSimilarity(queryEmbedding, entry.embedding)
      }));

      return scored
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(s => ({
          path: s.path,
          content: s.content,
          id: s.id
        }));
    } catch (err) {
      log(`Code search failed: ${String(err)}`);
      return [];
    }
  }
}