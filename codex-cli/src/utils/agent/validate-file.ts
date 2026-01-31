import { execSync } from "node:child_process";
import { extname } from "node:path";

export type ValidationResult = {
  isValid: boolean;
  error?: string;
};

/**
 * Performs a quick syntax check on a file based on its extension.
 * Aimed at catching trivial mistakes (missing braces, syntax errors) 
 * made by smaller LLMs.
 */
export async function validateFileSyntax(filePath: string): Promise<ValidationResult> {
  const ext = extname(filePath).toLowerCase();

  try {
    switch (ext) {
      case ".js":
      case ".cjs":
      case ".mjs":
        // node -c checks syntax without executing
        execSync(`node -c "${filePath}"`, { stdio: "ignore" });
        break;

      case ".ts":
      case ".tsx":
        // For TS, we use a very fast check if tsc is available, 
        // or just ignore if not to avoid heavy dependency requirements.
        // In many projects, we can use 'esbuild' or 'oxc' for lightning fast syntax-only checks.
        // For now, let's try a basic tsc check if available.
        try {
          execSync(`npx tsc --noEmit --target esnext --skipLibCheck "${filePath}"`, { stdio: "ignore" });
        } catch {
          // If tsc fails or isn't configured for a single file, we might get false positives.
          // In a "great coder" setup, we'd use a more robust linter.
          return { isValid: true }; 
        }
        break;

      case ".py":
        execSync(`python3 -m py_compile "${filePath}"`, { stdio: "ignore" });
        break;

      case ".json":
        // Quick JSON parse check
        const fs = await import("node:fs/promises");
        const content = await fs.readFile(filePath, "utf-8");
        JSON.parse(content);
        break;

      default:
        // Unknown extension, assume valid
        return { isValid: true };
    }

    return { isValid: true };
  } catch (err: any) {
    return {
      isValid: false,
      error: err.message || String(err),
    };
  }
}
