import { describe, it, expect } from "vitest";
import { getFileSearchMatch, filterFiles } from "../src/utils/autocomplete.js";

describe("Autocomplete Logic", () => {
  describe("getFileSearchMatch", () => {
    it("detects trigger at start of string", () => {
      expect(getFileSearchMatch("@file")).toEqual({
        query: "file",
        startIndex: 0,
      });
    });

    it("detects trigger after space", () => {
      expect(getFileSearchMatch("check @src")).toEqual({
        query: "src",
        startIndex: 6,
      });
    });

    it("detects trigger inside brackets", () => {
      expect(getFileSearchMatch("(@foo")).toEqual({
        query: "foo",
        startIndex: 1,
      });
      expect(getFileSearchMatch("[@bar")).toEqual({
        query: "bar",
        startIndex: 1,
      });
    });

    it("detects trigger inside quotes", () => {
      expect(getFileSearchMatch('"@baz')).toEqual({
        query: "baz",
        startIndex: 1,
      });
      expect(getFileSearchMatch("'@qux")).toEqual({
        query: "qux",
        startIndex: 1,
      });
    });

    it("returns null if @ is part of an email or word", () => {
      expect(getFileSearchMatch("user@example.com")).toBeNull();
      expect(getFileSearchMatch("aa@bb")).toBeNull();
    });

    it("returns null if query contains spaces (typing finished)", () => {
      expect(getFileSearchMatch("@file ")).toBeNull();
      expect(getFileSearchMatch("@file other")).toBeNull();
    });

    it("returns null if query contains closing delimiters", () => {
      expect(getFileSearchMatch("(@file)")).toBeNull();
      expect(getFileSearchMatch("[@file]")).toBeNull();
      expect(getFileSearchMatch("'@file'")).toBeNull();
    });
  });

  describe("filterFiles", () => {
    const files = [
      "src/app.tsx",
      "src/utils.ts",
      "src/components/button.tsx",
      "package.json",
      "README.md",
      "tests/app.test.ts",
    ];

    it("filters files containing the query", () => {
      const results = filterFiles(files, "app");
      expect(results).toContain("src/app.tsx");
      expect(results).toContain("tests/app.test.ts");
      expect(results).not.toContain("README.md");
    });

    it("prioritizes files starting with the query", () => {
      const results = filterFiles(files, "src");
      expect(results[0]).toBe("src/app.tsx"); // starts with src
      expect(results[1]).toBe("src/components/button.tsx");
    });

    it("is case insensitive", () => {
      const results = filterFiles(files, "README");
      expect(results).toContain("README.md");
    });

    it("limits results", () => {
      // Mock a larger list
      const manyFiles = Array.from({ length: 20 }, (_, i) => `file${i}.ts`);
      const results = filterFiles(manyFiles, "file", 5);
      expect(results.length).toBe(5);
    });
  });
});
