import chalk, { type ForegroundColorName } from "chalk";
import { z } from "zod";

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
});

/**
 * Defines the structure of a theme, mapping UI components to Chalk color names.
 */
export type Theme = {
  name: string;
  assistant: ForegroundColorName;
  user: ForegroundColorName;
  thought: ForegroundColorName;
  plan: ForegroundColorName;
  toolLabel: ForegroundColorName;
  toolIcon: ForegroundColorName;
  shellCommand: ForegroundColorName;
  error: ForegroundColorName;
  success: ForegroundColorName;
  warning: ForegroundColorName;
  highlight: ForegroundColorName;
  dim: ForegroundColorName;
  accent: ForegroundColorName;
  divider: ForegroundColorName;
  statusBarModel: ForegroundColorName;
  statusBarSession: ForegroundColorName;
};

/**
 * A collection of pre-defined themes.
 * The `default` theme is used as a fallback and as the base for custom theme configurations.
 */
export const themes: Record<string, Theme> = {
  default: {
    name: "Default (Codex)",
    assistant: "greenBright",
    user: "blueBright",
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
    accent: "blue",
    divider: "gray",
    statusBarModel: "cyan",
    statusBarSession: "magenta",
  },
  material: {
    name: "Material",
    assistant: "blue",
    user: "green",
    thought: "cyan",
    plan: "yellow",
    toolLabel: "blue",
    toolIcon: "blue",
    shellCommand: "yellow",
    error: "red",
    success: "green",
    warning: "yellow",
    highlight: "cyan",
    dim: "gray",
    accent: "blue",
    divider: "gray",
    statusBarModel: "blue",
    statusBarSession: "green",
  },
  dracula: {
    name: "Dracula",
    assistant: "magenta",
    user: "cyan",
    thought: "cyan",
    plan: "yellow",
    toolLabel: "magenta",
    toolIcon: "magenta",
    shellCommand: "yellow",
    error: "red",
    success: "green",
    warning: "yellow",
    highlight: "cyan",
    dim: "gray",
    accent: "magenta",
    divider: "gray",
    statusBarModel: "magenta",
    statusBarSession: "cyan",
  },
  solarized: {
    name: "Solarized",
    assistant: "blue",
    user: "green",
    thought: "cyan",
    plan: "yellow",
    toolLabel: "blue",
    toolIcon: "blue",
    shellCommand: "yellow",
    error: "red",
    success: "green",
    warning: "yellow",
    highlight: "cyan",
    dim: "gray",
    accent: "blue",
    divider: "gray",
    statusBarModel: "blue",
    statusBarSession: "green",
  },
  monochrome: {
    name: "Monochrome",
    assistant: "white",
    user: "white",
    thought: "white",
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
  },
  nord: {
    name: "Nord",
    assistant: "blue",
    user: "cyan",
    thought: "blueBright",
    plan: "yellow",
    toolLabel: "cyan",
    toolIcon: "blue",
    shellCommand: "yellow",
    error: "red",
    success: "green",
    warning: "yellow",
    highlight: "cyanBright",
    dim: "gray",
    accent: "blue",
    divider: "gray",
    statusBarModel: "blueBright",
    statusBarSession: "cyan",
  },
  oneDark: {
    name: "One Dark",
    assistant: "magenta",
    user: "green",
    thought: "cyan",
    plan: "yellow",
    toolLabel: "blue",
    toolIcon: "blue",
    shellCommand: "yellow",
    error: "red",
    success: "green",
    warning: "yellow",
    highlight: "cyan",
    dim: "gray",
    accent: "magenta",
    divider: "gray",
    statusBarModel: "blue",
    statusBarSession: "magenta",
  },
  synthwave: {
    name: "Synthwave",
    assistant: "magentaBright",
    user: "cyanBright",
    thought: "yellowBright",
    plan: "magenta",
    toolLabel: "blueBright",
    toolIcon: "blueBright",
    shellCommand: "yellow",
    error: "red",
    success: "green",
    warning: "yellow",
    highlight: "cyan",
    dim: "gray",
    accent: "magentaBright",
    divider: "gray",
    statusBarModel: "magentaBright",
    statusBarSession: "cyanBright",
  },
  gruvbox: {
    name: "Gruvbox",
    assistant: "yellow",
    user: "blue",
    thought: "cyan",
    plan: "magenta",
    toolLabel: "green",
    toolIcon: "green",
    shellCommand: "yellow",
    error: "red",
    success: "green",
    warning: "yellow",
    highlight: "cyan",
    dim: "gray",
    accent: "yellow",
    divider: "gray",
    statusBarModel: "yellow",
    statusBarSession: "blue",
  },
  cyberpunk: {
    name: "Cyberpunk",
    assistant: "yellowBright",
    user: "blueBright",
    thought: "magentaBright",
    plan: "cyanBright",
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
  }
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
export function getTheme(themeConfig?: string | z.infer<typeof ThemeSchema>): Theme {
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
export function getSyntaxTheme(theme: Theme) {
  return {
    keyword: chalk.magentaBright,
    built_in: chalk.cyanBright,
    type: chalk.cyanBright,
    literal: chalk.yellowBright,
    number: chalk.yellowBright,
    regexp: chalk.redBright,
    string: chalk.greenBright,
    class: chalk.blueBright,
    function: chalk.blueBright,
    comment: chalk.gray,
    doctag: chalk.gray,
    meta: chalk.gray,
    "meta-keyword": chalk.gray,
    "meta-string": chalk.gray,
    section: chalk.bold,
    tag: chalk.cyanBright,
    name: chalk.cyanBright,
    attr: chalk.cyanBright,
    attribute: chalk.cyanBright,
    property: chalk.cyanBright, // Added for JSON keys
    variable: chalk.white,
    bullet: chalk.magentaBright,
    code: chalk.white,
    emphasis: chalk.italic,
    strong: chalk.bold,
    formula: chalk.gray,
    link: chalk[theme.highlight as ForegroundColorName]?.underline || chalk.cyanBright.underline,
    quote: chalk.gray,
    "selector-tag": chalk.magentaBright,
    "selector-id": chalk.magentaBright,
    "selector-class": chalk.magentaBright,
    "selector-attr": chalk.magentaBright,
    "selector-pseudo": chalk.magentaBright,
    "template-tag": chalk.magentaBright,
    "template-variable": chalk.white,
    addition: chalk.green,
    deletion: chalk.red,
  };
}
