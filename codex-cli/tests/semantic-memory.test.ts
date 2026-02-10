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

    // Mock process.cwd()
    vi.spyOn(process, "cwd").mockReturnValue("/mock/cwd");

    // Mock existsSync to return true for cache/index paths to avoid creation errors
    vi.mocked(fs.existsSync).mockReturnValue(false);

    semanticMemory = new SemanticMemory(mockOai);
  });

  it("skips binary files during indexing", async () => {
    const mockFiles = [
      { name: "code.ts", isFile: () => true, isDirectory: () => false },
      { name: "image.png", isFile: () => true, isDirectory: () => false }
    ];

    vi.mocked(fs.readdirSync).mockReturnValue(mockFiles as any);
    
    // image.png will be considered binary if it contains a null byte
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

    // Should only have embedded code.ts
    // The call count might be higher due to chunks, but it should contain "File: code.ts"
    const embedCalls = mockOai.embeddings.create.mock.calls;
    const embeddedPaths = embedCalls.map((call: any) => call[0].input);
    
    expect(embeddedPaths.some((p: string) => p.includes("code.ts"))).toBe(true);
    expect(embeddedPaths.some((p: string) => p.includes("image.png"))).toBe(false);
  });

  it("reuses cached embeddings for unchanged files", async () => {
    // 1. Initial indexing
    vi.mocked(fs.readdirSync).mockReturnValue([
      { name: "test.ts", isFile: () => true, isDirectory: () => false }
    ] as any);
    vi.mocked(fs.readFileSync).mockReturnValue("content");
    vi.mocked(fs.statSync).mockReturnValue({ mtimeMs: 100 } as any);

    await semanticMemory.indexCodebase();
    expect(mockOai.embeddings.create).toHaveBeenCalledTimes(1);

    // 2. Second indexing with same mtime
    mockOai.embeddings.create.mockClear();
    await semanticMemory.indexCodebase();
    
    // Should NOT have called embeddings.create again
    expect(mockOai.embeddings.create).toHaveBeenCalledTimes(0);
  });
});
