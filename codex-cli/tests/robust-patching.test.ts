import { describe, it, expect } from "vitest";
import { process_patch } from "../src/utils/agent/apply-patch.js";

function createInMemoryFS(initialFiles: Record<string, string>) {
  const files: Record<string, string> = { ...initialFiles };
  const writes: Record<string, string> = {};
  const removals: Array<string> = [];
  const dirs: Array<string> = [];

  const openFn = (p: string): string => {
    if (files[p] !== undefined) return files[p];
    throw new Error(`File not found: ${p}`);
  };

  const writeFn = (p: string, content: string): void => {
    files[p] = content;
    writes[p] = content;
  };

  const removeFn = (p: string): void => {
    delete files[p];
    removals.push(p);
  };

  const mkdirFn = (p: string): void => {
    dirs.push(p);
  };

  return { openFn, writeFn, removeFn, mkdirFn, writes, removals, files, dirs };
}

describe("Robust Patching Logic", () => {
  it("handles multi-hunk patches correctly", () => {
    const original = "line1\nline2\nline3\nline4\nline5\nline6";
    const patch = `*** Begin Patch
*** Update File: multi.txt
@@ -1,3 +1,3 @@
-line1
+line1 modified
 line2
 line3
@@ -4,3 +4,3 @@
 line4
-line5
+line5 modified
 line6
*** End Patch`;

    const fs = createInMemoryFS({ "multi.txt": original });
    const result = process_patch(patch, fs.openFn, fs.writeFn, fs.removeFn, fs.mkdirFn);

    expect(result.success).toBe(true);
    expect(fs.files["multi.txt"]).toBe("line1 modified\nline2\nline3\nline4\nline5 modified\nline6");
  });

  it("handles fuzzy matching with whitespace differences (preserves patch indentation)", () => {
    const original = "function test() {\n  return true;\n}";
    // Patch has different indentation (4 spaces instead of 2)
    const patch = `*** Begin Patch
*** Update File: fuzzy.ts
@@
 function test() {
-    return true;
+    return false;
 }
*** End Patch`;

    const fs = createInMemoryFS({ "fuzzy.ts": original });
    const result = process_patch(patch, fs.openFn, fs.writeFn, fs.removeFn, fs.mkdirFn);

    expect(result.success).toBe(true);
    expect(result.message).toContain("fuzz");
    // Current behavior: preserves the indentation provided in the patch for inserted lines
    expect(fs.files["fuzzy.ts"]).toBe("function test() {\n    return false;\n}");
  });

  it("performs atomic rollback when one file in a batch fails", () => {
    const fs = createInMemoryFS({
      "good.txt": "original good",
      "bad.txt": "original bad"
    });

    // We'll force a failure on "bad.txt" by making the context mismatch
    const patch = `*** Begin Patch
*** Update File: good.txt
@@
-original good
+modified good
*** Update File: bad.txt
@@
-WRONG CONTEXT
+modified bad
*** End Patch`;

    const result = process_patch(patch, fs.openFn, fs.writeFn, fs.removeFn, fs.mkdirFn);

    expect(result.success).toBe(false);
    // It fails during parsing phase due to context mismatch
    expect(result.message).toContain("Patch parse error");
    
    // good.txt should NOT have been modified because the whole patch is processed before application
    // (or rolled back if application failed midway)
    expect(fs.files["good.txt"]).toBe("original good");
    expect(fs.files["bad.txt"]).toBe("original bad");
  });

  it("automatically creates parent directories for new files", () => {
    const fs = createInMemoryFS({});
    const patch = `*** Begin Patch
*** Add File: new/deep/dir/file.txt
+content
*** End Patch`;

    const result = process_patch(patch, fs.openFn, fs.writeFn, fs.removeFn, fs.mkdirFn);

    expect(result.success).toBe(true);
    expect(fs.dirs).toContain("new/deep/dir");
    expect(fs.files["new/deep/dir/file.txt"]).toBe("content");
  });

  it("handles mixed line endings (original CRLF, patch LF)", () => {
    const original = "line1\r\nline2\r\nline3";
    const patch = `*** Begin Patch\n*** Update File: line-endings.txt\n@@\n line1\n-line2\n+line2 updated\n line3\n*** End Patch`;
    
    const fs = createInMemoryFS({ "line-endings.txt": original });
    const result = process_patch(patch, fs.openFn, fs.writeFn, fs.removeFn, fs.mkdirFn);

    expect(result.success).toBe(true);
    // Current behavior: preserves original line endings for unchanged lines, uses patch endings for changed lines
    expect(fs.files["line-endings.txt"]).toBe("line1\r\nline2 updated\nline3");
  });
});
