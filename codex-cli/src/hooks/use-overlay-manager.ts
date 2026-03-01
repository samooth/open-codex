import { useState, useCallback } from "react";

export type OverlayMode =
  | "none"
  | "history"
  | "model"
  | "approval"
  | "help"
  | "config"
  | "prompt"
  | "memory"
  | "prompts"
  | "history-select"
  | "theme"
  | "recipes"
  | "palette"
  | "search-url-searxng"
  | "search-url-generic"
  | "serp-api-key"
  | "editor"
  | "commands";

export function useOverlayManager() {
  const [overlayMode, setOverlayMode] = useState<OverlayMode>("none");

  const openOverlay = useCallback((mode: OverlayMode) => {
    setOverlayMode(mode);
  }, []);

  const closeOverlay = useCallback(() => {
    setOverlayMode("none");
  }, []);

  return {
    overlayMode,
    openOverlay,
    closeOverlay,
  };
}
