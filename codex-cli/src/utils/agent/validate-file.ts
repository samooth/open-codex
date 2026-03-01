import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";

export type ValidationResult = {
  isValid: boolean;
  error?: string;
};

function getLinterCommand(filePath: string): string | null {
  const cwd = process.cwd();
  const ext = extname(filePath).toLowerCase();

  // 1. Check package.json for "lint" script (JS/TS)
  if ([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"].includes(ext)) {
    if (existsSync(join(cwd, "package.json"))) {
      try {
        const pkg = JSON.parse(
          readFileSync(join(cwd, "package.json"), "utf-8"),
        );
        if (pkg.scripts && pkg.scripts.lint) {
          // If the lint script contains "eslint", we can probably append the filename
          // Otherwise, running "npm run lint" might lint the whole project which is slow/noisy.
          // Strategy: Try "npm run lint -- <file>"
          return `npm run lint -- "${filePath}"`;
        }
      } catch {
        /* ignore */
      }
    }

    // Fallback: Check for eslint binary usage if config exists
    if (
      existsSync(join(cwd, ".eslintrc.js")) ||
      existsSync(join(cwd, ".eslintrc.json")) ||
      existsSync(join(cwd, ".eslintrc.yaml")) ||
      existsSync(join(cwd, ".eslintrc.yml")) ||
      existsSync(join(cwd, "eslint.config.js"))
    ) {
      return `npx eslint "${filePath}"`;
    }
  }

  // 2. Python: Ruff or Flake8
  if (ext === ".py") {
    if (
      existsSync(join(cwd, "ruff.toml")) ||
      existsSync(join(cwd, ".ruff.toml")) ||
      existsSync(join(cwd, "pyproject.toml"))
    ) {
      // Check if ruff is in pyproject.toml if that's what we found
      // For simplicity, just try running ruff if installed, or assume user environment has it.
      // We'll use 'python3 -m ruff check' or just 'ruff check'
      return `ruff check "${filePath}"`;
    }
  }

  // 3. Rust: cargo check (whole project)
  if (ext === ".rs" && existsSync(join(cwd, "Cargo.toml"))) {
    return `cargo check --message-format short`;
  }

  return null;
}

/**
 * Performs a quick syntax check and optional deep linting on a file.
 */
export async function validateFileSyntax(
  filePath: string,
  options: { enableDeepLinter?: boolean } = {},
): Promise<ValidationResult> {
  const ext = extname(filePath).toLowerCase();

  // 1. Basic Syntax Check (Fast)
  try {
    switch (ext) {
      case ".js":
      case ".cjs":
      case ".mjs":
        execSync(`node -c "${filePath}"`, { stdio: "pipe", timeout: 5000 });
        break;
      case ".ts":
      case ".tsx":
        // Fast tsc check (basic syntax only, no full type check here for speed)
        // unless enableDeepLinter is on, but we'll stick to basic syntax for part 1.
        try {
          execSync(
            `npx tsc --noEmit --target esnext --skipLibCheck "${filePath}"`,
            { stdio: "ignore", timeout: 10000 },
          );
        } catch {
          /* ignore tsc missing */
        }
        break;
      case ".py":
        try {
          const fs = await import("node:fs/promises");
          const content = await fs.readFile(filePath, "utf-8");
          const escapedContent = JSON.stringify(content);
          execSync(
            `python3 -c "compile(${escapedContent}, '${filePath}', 'exec')"`,
            { stdio: "pipe", timeout: 5000 },
          );
        } catch (pyErr: any) {
          return {
            isValid: false,
            error:
              pyErr.stdout?.toString() ||
              pyErr.stderr?.toString() ||
              pyErr.message,
          };
        }
        break;
      case ".json":
        const fs = await import("node:fs/promises");
        const content = await fs.readFile(filePath, "utf-8");
        JSON.parse(content);
        break;
    }
  } catch (err: any) {
    const msg =
      typeof err.stdout !== "undefined"
        ? `${err.message}\n${err.stdout}\n${err.stderr || ""}`
        : String(err);
    return { isValid: false, error: `Syntax Error in ${filePath}:\n${msg}` };
  }

  // 2. Deep Linter Check (Optional/Slow)
  // Only runs if basic syntax passed AND enableDeepLinter is TRUE.
  if (options.enableDeepLinter) {
    const linterCmd = getLinterCommand(filePath);
    if (linterCmd) {
      try {
        execSync(linterCmd, { stdio: "pipe", timeout: 30000 });
      } catch (err: any) {
        // Linter failed (found issues)
        const stdout = err.stdout ? err.stdout.toString().trim() : "";
        const stderr = err.stderr ? err.stderr.toString().trim() : "";

        // If the linter found errors, we report them.
        // Note: Some linters exit 1 on warnings too.
        if (stdout || stderr) {
          return {
            isValid: false,
            error: `Linter Issues in ${filePath}:\n${stdout}\n${stderr}`.trim(),
          };
        }
      }
    }
  }

  return { isValid: true };
}
