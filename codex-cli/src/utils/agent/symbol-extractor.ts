import { readFileSync } from "fs";
import { extname } from "path";

export interface SymbolInfo {
  name: string;
  type: string;
  line: number;
}

export function extractSymbols(filePath: string): string {
  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const ext = extname(filePath).toLowerCase();
  
  const symbols: SymbolInfo[] = [];

  // Basic regex-based extraction for common languages
  const rules = getRulesForExtension(ext);
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line || line.startsWith("//") || line.startsWith("#") || line.startsWith("/*")) continue;

    for (const rule of rules) {
      const match = line.match(rule.regex);
      if (match && match[1]) {
        symbols.push({
          name: match[1],
          type: rule.type,
          line: i + 1
        });
        break;
      }
    }
  }

  if (symbols.length === 0) {
    return "No significant symbols found or file type not supported for symbol extraction.";
  }

  return symbols
    .map(s => `[L${s.line}] ${s.type.padEnd(10)} ${s.name}`)
    .join("\n");
}

interface Rule {
  regex: RegExp;
  type: string;
}

function getRulesForExtension(ext: string): Rule[] {
  switch (ext) {
    case ".ts":
    case ".tsx":
    case ".js":
    case ".jsx":
      return [
        { regex: /^(?:export\s+)?class\s+([a-zA-Z0-9_]+)/, type: "class" },
        { regex: /^(?:export\s+)?(?:async\s+)?function\s+([a-zA-Z0-9_]+)/, type: "function" },
        { regex: /^(?:export\s+)?interface\s+([a-zA-Z0-9_]+)/, type: "interface" },
        { regex: /^(?:export\s+)?type\s+([a-zA-Z0-9_]+)/, type: "type" },
        { regex: /^(?:export\s+)?const\s+([a-zA-Z0-9_]+)\s*=/, type: "const" },
      ];
    case ".py":
      return [
        { regex: /^class\s+([a-zA-Z0-9_]+)/, type: "class" },
        { regex: /^def\s+([a-zA-Z0-9_]+)/, type: "function" },
      ];
    case ".rs":
      return [
        { regex: /^(?:pub\s+)?struct\s+([a-zA-Z0-9_]+)/, type: "struct" },
        { regex: /^(?:pub\s+)?enum\s+([a-zA-Z0-9_]+)/, type: "enum" },
        { regex: /^(?:pub\s+)?trait\s+([a-zA-Z0-9_]+)/, type: "trait" },
        { regex: /^(?:pub\s+)?fn\s+([a-zA-Z0-9_]+)/, type: "function" },
        { regex: /^impl(?:\s+.*)?\s+([a-zA-Z0-9_]+)\s+{/, type: "impl" },
      ];
    case ".go":
      return [
        { regex: /^type\s+([a-zA-Z0-9_]+)\s+struct/, type: "struct" },
        { regex: /^type\s+([a-zA-Z0-9_]+)\s+interface/, type: "interface" },
        { regex: /^func\s+([a-zA-Z0-9_]+)\(/, type: "function" },
        { regex: /^func\s+\(.*\)\s+([a-zA-Z0-9_]+)\(/, type: "method" },
      ];
    default:
      return [];
  }
}
