import type { ForegroundColorName } from "chalk";

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
  }
};

export function getTheme(name?: string): Theme {
  return themes[name || "default"] || themes["default"]!;
}
