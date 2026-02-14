import { describe, it, expect, vi, beforeEach } from "vitest";
import { SemanticMemory } from "../src/utils/agent/semantic-memory.js";
import fs from "fs";
import * as ignoreUtils from "../src/utils/agent/ignore-utils.js";

vi.mock("fs");
vi.mock("../src/utils/agent/ignore-utils.js");
vi.mock("openai");

describe("SemanticMemory", () => {
  let mockOai: any;
  let semanticMemory: SemanticMemory;

  beforeEach(() => {
    vi.clearAllMocks();
    mockOai = {
      embeddings: {
        create: vi.fn().mockResolvedValue({
          data: [{ embedding: [0.1, 0.2, 0.3] }]
        })
      }
    };

    vi.mocked(ignoreUtils.getIgnoreFilter).mockReturnValue({
      ignores: () => false
    } as any);

    vi.spyOn(process, "cwd").mockReturnValue("/mock/cwd");
    vi.mocked(fs.existsSync).mockReturnValue(false);

    semanticMemory = new SemanticMemory(mockOai);
  });

  it("skips binary files during indexing", async () => {
    const mockFiles = [
      { name: "code.ts", isFile: () => true, isDirectory: () => false },
      { name: "image.png", isFile: () => true, isDirectory: () => false }
    ];

    vi.mocked(fs.readdirSync).mockReturnValue(mockFiles as any);
    
    vi.mocked(fs.readFileSync).mockImplementation((path: any) => {
      if (path.includes("image.png")) {
        const buf = Buffer.alloc(10);
        buf[0] = 0; // null byte
        return buf;
      }
      return "console.log('hello')";
    });

    vi.mocked(fs.statSync).mockReturnValue({ mtimeMs: 123 } as any);

    await semanticMemory.indexCodebase();

    const embedCalls = mockOai.embeddings.create.mock.calls;
    const embeddedPaths = embedCalls.map((call: any) => call[0].input);
    
    expect(embeddedPaths.some((p: string) => p.includes("code.ts"))).toBe(true);
    expect(embeddedPaths.some((p: string) => p.includes("image.png"))).toBe(false);
  });

  it("reuses cached embeddings for unchanged files", async () => {
    vi.mocked(fs.readdirSync).mockReturnValue([
      { name: "test.ts", isFile: () => true, isDirectory: () => false }
    ] as any);
    vi.mocked(fs.readFileSync).mockReturnValue("content");
    vi.mocked(fs.statSync).mockReturnValue({ mtimeMs: 100 } as any);

    await semanticMemory.indexCodebase();
    expect(mockOai.embeddings.create).toHaveBeenCalledTimes(1);

    mockOai.embeddings.create.mockClear();
    await semanticMemory.indexCodebase();
    
    expect(mockOai.embeddings.create).toHaveBeenCalledTimes(0);
  });

  it("boosts symbol definitions in searchSymbols", async () => {
    (semanticMemory as any).entries = [
      { 
        id: "usage", 
        path: "main.ts", 
        content: "const user = new User();", 
        embedding: [1, 0, 0] 
      },
      { 
        id: "definition", 
        path: "user.ts", 
        content: "export class User { id: string; }", 
        embedding: [0, 1, 0] 
      }
    ];

    // Mock getEmbedding to return [0, 1, 0] which matches definition exactly
    vi.spyOn(semanticMemory as any, "getEmbedding").mockResolvedValue([0, 1, 0]);

    const results = await semanticMemory.searchSymbols("User");
    
    // definition has similarity 1.0 + 0.5 boost = 1.5
    // usage has similarity 0.0
    expect(results[0].path).toBe("user.ts");
    expect(results[0].id).toBe("definition");
  });
});
