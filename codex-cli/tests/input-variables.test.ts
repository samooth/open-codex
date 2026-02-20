import { processInputVariables } from "../src/utils/input-utils.js";
import { describe, it, expect, vi } from "vitest";
import fs from "fs/promises";
import { existsSync } from "fs";

vi.mock("fs", async () => {
  const actual = await vi.importActual("fs") as any;
  return {
    ...actual,
    existsSync: vi.fn(),
  };
});

vi.mock("fs/promises", () => ({
  default: {
    readFile: vi.fn(),
  },
}));

describe("processInputVariables", () => {
  it("should inject environment variables", async () => {
    process.env["TEST_VAR"] = "test-value";
    const input = "Hello {{TEST_VAR}}";
    const output = await processInputVariables(input);
    expect(output).toBe("Hello test-value");
  });

  it("should inject file contents", async () => {
    (existsSync as any).mockReturnValue(true);
    (fs.readFile as any).mockResolvedValue("file-content");
    
    const input = "Read {{test.txt}}";
    const output = await processInputVariables(input);
    
    expect(output).toContain("--- Content from test.txt ---");
    expect(output).toContain("file-content");
  });

  it("should leave unknown variables as is", async () => {
    (existsSync as any).mockReturnValue(false);
    const input = "Unknown {{UNKNOWN_VAR}}";
    const output = await processInputVariables(input);
    expect(output).toBe("Unknown {{UNKNOWN_VAR}}");
  });
});
