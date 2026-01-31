import OpenAI from "openai";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { log } from "./log.js";

type EmbeddingCache = Record<string, number[]>;

export class SemanticMemory {
  private cache: EmbeddingCache = {};
  private cachePath: string;
  private memoryPath: string;
  private oai: OpenAI;

  constructor(oai: OpenAI) {
    this.oai = oai;
    this.cachePath = join(process.cwd(), ".codex", "memory_embeddings.json");
    this.memoryPath = join(process.cwd(), ".codex", "memory.md");
    this.loadCache();
  }

  private loadCache() {
    if (existsSync(this.cachePath)) {
      try {
        this.cache = JSON.parse(readFileSync(this.cachePath, "utf-8"));
      } catch {
        this.cache = {};
      }
    }
  }

  private saveCache() {
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

  private async getEmbedding(text: string): Promise<number[]> {
    if (this.cache[text]) {
      return this.cache[text]!;
    }

    const response = await this.oai.embeddings.create({
      model: "text-embedding-3-small",
      input: text,
    });

    const embedding = response.data[0]!.embedding;
    this.cache[text] = embedding;
    this.saveCache();
    return embedding;
  }

  private cosineSimilarity(a: number[], b: number[]): number {
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
    if (!existsSync(this.memoryPath)) return [];

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

      // If semantic search yields nothing relevant, return the most recent entries
      return relevant.length > 0 ? relevant : lines.slice(-limit);
    } catch (err) {
      log(`Semantic memory search failed: ${String(err)}`);
      return lines.slice(-limit); // Fallback to most recent entries
    }
  }
}
