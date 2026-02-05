import type { ForegroundColorName } from "chalk";
import { z } from "zod";

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
  statusBarModel: z.string().optional(),
  statusBarSession: z.string().optional(),
});

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
  statusBarModel: ForegroundColorName;
  statusBarSession: ForegroundColorName;
};

export const themes: Record<string, Theme> = {
  default: {
    name: "Default (Codex)",
    assistant: "magentaBright",
    user: "blueBright",
    thought: "cyan",
    plan: "yellow",
    toolLabel: "magentaBright",
    toolIcon: "magentaBright",
    shellCommand: "yellow",
    error: "redBright",
    success: "greenBright",
    warning: "yellowBright",
    highlight: "cyanBright",
    dim: "gray",
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
    statusBarModel: "yellowBright",
    statusBarSession: "blueBright",
  }
};

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
