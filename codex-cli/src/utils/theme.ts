import chalk, { type ForegroundColorName } from "chalk";
import { z } from "zod";

/**
 * A theme color: either an ANSI color name (used with `chalk[name]`) or a
 * hex string like "#8a8a98" (used with `chalk.hex()`). Hex is preferred for
 * `dim`-style tokens because ANSI `gray` is bright-black and disappears on
 * dark backgrounds.
 */
export type ThemeColor = ForegroundColorName | `#${string}`;

/**
 * Resolve a theme color to a chalk chainable instance, supporting both
 * ANSI names and hex values.
 */
export function chalkFor(color: ThemeColor): ReturnType<typeof chalk.hex> {
  if (color.startsWith("#")) {
    return chalk.hex(color);
  }
  return (chalk as any)[color] ?? chalk.reset;
}

/**
 * Zod schema for validating a custom theme object.
 * Ensures that theme properties are optional strings compatible with Chalk colors.
 */
export const ThemeSchema = z.object({
  name: z.string().optional(),
  assistant: z.string().optional(),
  user: z.string().optional(),
  thought: z.string().optional(),
  plan: z.string().optional(),
  toolLabel: z.string().optional(),
  toolIcon: z.string().optional(),
  shellCommand: z.string().optional(),
  error: z.string().optional(),
  success: z.string().optional(),
  warning: z.string().optional(),
  highlight: z.string().optional(),
  dim: z.string().optional(),
  accent: z.string().optional(),
  divider: z.string().optional(),
  statusBarModel: z.string().optional(),
  statusBarSession: z.string().optional(),
  deletion: z.string().optional(),
});

/**
 * Defines the structure of a theme, mapping UI components to Chalk colors.
 */
export type Theme = {
  name: string;
  assistant: ThemeColor;
  user: ThemeColor;
  thought: ThemeColor;
  plan: ThemeColor;
  toolLabel: ThemeColor;
  toolIcon: ThemeColor;
  shellCommand: ThemeColor;
  error: ThemeColor;
  success: ThemeColor;
  warning: ThemeColor;
  highlight: ThemeColor;
  dim: ThemeColor;
  accent: ThemeColor;
  divider: ThemeColor;
  statusBarModel: ThemeColor;
  statusBarSession: ThemeColor;
  deletion: ThemeColor;
};

/**
 * A collection of pre-defined themes.
 * The `default` theme is used as a fallback and as the base for custom theme configurations.
 *
 * Design language (mirrors Kilo Code's OC-2 tokens in a terminal palette):
 * - Neutral grayscale hierarchy (strong ≈ 95%, base ≈ 60%, dim ≈ 40%).
 * - A single blue accent (`blueBright`) for interactive/selected elements.
 * - Semantic color (green/red/yellow) reserved for status, never decoration.
 */
export const themes: Record<string, Theme> = {
  default: {
    name: "Kilo (Default)",
    assistant: "white",
    user: "yellowBright",
    thought: "#8a8a98",
    plan: "magenta",
    toolLabel: "white",
    toolIcon: "#8a8a98",
    shellCommand: "white",
    error: "redBright",
    success: "green",
    warning: "yellow",
    highlight: "#ffd76a",
    dim: "#8a8a98",
    accent: "#ffd76a",
    divider: "#5c5c68",
    statusBarModel: "white",
    statusBarSession: "#8a8a98",
    deletion: "red",
  },
  classic: {
    name: "Classic (Codex)",
    assistant: "greenBright",
    user: "white",
    thought: "cyan",
    plan: "yellow",
    toolLabel: "blueBright",
    toolIcon: "blueBright",
    shellCommand: "yellow",
    error: "redBright",
    success: "greenBright",
    warning: "yellowBright",
    highlight: "cyanBright",
    dim: "gray",
    accent: "blueBright",
    divider: "gray",
    statusBarModel: "cyan",
    statusBarSession: "magenta",
    deletion: "magenta",
  },
  material: {
    name: "Material",
    assistant: "blueBright",
    user: "cyanBright",
    thought: "gray",
    plan: "yellowBright",
    toolLabel: "blue",
    toolIcon: "cyan",
    shellCommand: "green",
    error: "red",
    success: "green",
    warning: "yellow",
    highlight: "blueBright",
    dim: "gray",
    accent: "blue",
    divider: "gray",
    statusBarModel: "blue",
    statusBarSession: "cyan",
    deletion: "magenta",
  },
  dracula: {
    name: "Dracula",
    assistant: "magentaBright",
    user: "cyanBright",
    thought: "blueBright",
    plan: "yellowBright",
    toolLabel: "greenBright",
    toolIcon: "magenta",
    shellCommand: "yellow",
    error: "redBright",
    success: "greenBright",
    warning: "yellow",
    highlight: "magenta",
    dim: "gray",
    accent: "magenta",
    divider: "gray",
    statusBarModel: "magenta",
    statusBarSession: "cyan",
    deletion: "magenta",
  },
  solarized: {
    name: "Solarized",
    assistant: "blue",
    user: "green",
    thought: "cyan",
    plan: "yellow",
    toolLabel: "blue",
    toolIcon: "cyan",
    shellCommand: "green",
    error: "red",
    success: "greenBright",
    warning: "yellowBright",
    highlight: "magenta",
    dim: "gray",
    accent: "blue",
    divider: "gray",
    statusBarModel: "blue",
    statusBarSession: "green",
    deletion: "red", // Solarized red is distinct
  },
  monochrome: {
    name: "Monochrome",
    assistant: "white",
    user: "white",
    thought: "gray",
    plan: "white",
    toolLabel: "white",
    toolIcon: "white",
    shellCommand: "white",
    error: "white",
    success: "white",
    warning: "white",
    highlight: "white",
    dim: "gray",
    accent: "white",
    divider: "gray",
    statusBarModel: "white",
    statusBarSession: "white",
    deletion: "gray",
  },
  nord: {
    name: "Nord",
    assistant: "cyan",
    user: "blueBright",
    thought: "gray",
    plan: "white",
    toolLabel: "cyanBright",
    toolIcon: "blue",
    shellCommand: "cyan",
    error: "red",
    success: "green",
    warning: "yellow",
    highlight: "blue",
    dim: "gray",
    accent: "blue",
    divider: "gray",
    statusBarModel: "blueBright",
    statusBarSession: "cyan",
    deletion: "magenta",
  },
  oneDark: {
    name: "One Dark",
    assistant: "blue",
    user: "green",
    thought: "magenta",
    plan: "yellow",
    toolLabel: "cyan",
    toolIcon: "blueBright",
    shellCommand: "yellowBright",
    error: "redBright",
    success: "green",
    warning: "yellow",
    highlight: "blue",
    dim: "gray",
    accent: "magenta",
    divider: "gray",
    statusBarModel: "blue",
    statusBarSession: "magenta",
    deletion: "magentaBright",
  },
  synthwave: {
    name: "Synthwave",
    assistant: "magentaBright",
    user: "cyanBright",
    thought: "blueBright",
    plan: "yellowBright",
    toolLabel: "magenta",
    toolIcon: "cyan",
    shellCommand: "yellow",
    error: "redBright",
    success: "greenBright",
    warning: "yellowBright",
    highlight: "blueBright",
    dim: "gray",
    accent: "magentaBright",
    divider: "gray",
    statusBarModel: "magentaBright",
    statusBarSession: "cyanBright",
    deletion: "magenta",
  },
  gruvbox: {
    name: "Gruvbox",
    assistant: "yellow",
    user: "green",
    thought: "blue",
    plan: "redBright",
    toolLabel: "greenBright",
    toolIcon: "yellowBright",
    shellCommand: "yellow",
    error: "red",
    success: "green",
    warning: "yellowBright",
    highlight: "cyan",
    dim: "gray",
    accent: "yellow",
    divider: "gray",
    statusBarModel: "yellow",
    statusBarSession: "blue",
    deletion: "red", // Gruvbox red is iconic
  },
  cyberpunk: {
    name: "Cyberpunk",
    assistant: "yellowBright",
    user: "blueBright",
    thought: "magentaBright",
    plan: "greenBright",
    toolLabel: "yellow",
    toolIcon: "yellow",
    shellCommand: "blue",
    error: "redBright",
    success: "greenBright",
    warning: "yellowBright",
    highlight: "magenta",
    dim: "gray",
    accent: "yellowBright",
    divider: "gray",
    statusBarModel: "yellowBright",
    statusBarSession: "blueBright",
    deletion: "magentaBright",
  },
  matrix: {
    name: "Matrix",
    assistant: "greenBright",
    user: "green",
    thought: "gray",
    plan: "greenBright",
    toolLabel: "green",
    toolIcon: "greenBright",
    shellCommand: "green",
    error: "redBright",
    success: "greenBright",
    warning: "yellow",
    highlight: "greenBright",
    dim: "gray",
    accent: "greenBright",
    divider: "gray",
    statusBarModel: "greenBright",
    statusBarSession: "green",
    deletion: "greenBright",
  },
};

/**
 * Retrieves a complete theme configuration based on the provided input.
 * - If `themeConfig` is undefined, it returns the `default` theme.
 * - If `themeConfig` is a string, it looks up a pre-defined theme by that name. If not found, it falls back to the `default` theme.
 * - If `themeConfig` is an object, it merges the provided properties with the `default` theme, allowing for partial customizations.
 *
 * @param themeConfig - An optional string identifier for a pre-defined theme or a custom theme object.
 * @returns A complete `Theme` object.
 */
export function getTheme(
  themeConfig?: string | z.infer<typeof ThemeSchema>,
): Theme {
  if (!themeConfig) {
    return themes["default"]!;
  }

  if (typeof themeConfig === "string") {
    return themes[themeConfig] || themes["default"]!;
  }

  // If it's an object, merge it with the default theme
  return {
    ...themes["default"]!,
    ...themeConfig,
  } as Theme;
}

/**
 * Returns a theme object compatible with `cli-highlight`.
 * Uses the provided UI theme to ensure consistency and readability.
 */
export function getSyntaxTheme(_theme: Theme) {
  return {
    "keyword": chalk.magentaBright,
    "built_in": chalk.cyanBright,
    "type": chalk.cyanBright,
    "literal": chalk.yellowBright,
    "number": chalk.yellowBright,
    "regexp": chalk.redBright,
    "string": chalk.greenBright,
    "class": chalk.blueBright,
    "function": chalk.blueBright,
    "comment": chalk.gray,
    "doctag": chalk.gray,
    "meta": chalk.gray,
    "meta-keyword": chalk.gray,
    "meta-string": chalk.gray,
    "section": chalk.bold,
    "tag": chalk.cyanBright,
    "name": chalk.cyanBright,
    "attr": chalk.cyanBright,
    "attribute": chalk.cyanBright,
    "property": chalk.cyanBright, // Added for JSON keys
    "variable": chalk.white,
    "bullet": chalk.magentaBright,
    "code": chalk.white,
    "emphasis": chalk.italic,
    "strong": chalk.bold,
    "formula": chalk.gray,
    "link": chalk.cyanBright.underline,
    "quote": chalk.gray,
    "selector-tag": chalk.magentaBright,
    "selector-id": chalk.magentaBright,
    "selector-class": chalk.magentaBright,
    "selector-attr": chalk.magentaBright,
    "selector-pseudo": chalk.magentaBright,
    "template-tag": chalk.magentaBright,
    "template-variable": chalk.white,
    "addition": chalk.green,
    "deletion": chalk.red,
  };
}
