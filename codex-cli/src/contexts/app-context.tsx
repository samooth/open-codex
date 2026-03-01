import type { AppConfig } from "../utils/config.js";
import type { ReactNode } from "react";
import {
  useOverlayManager,
  type OverlayMode,
} from "../hooks/use-overlay-manager.js";

import React, { createContext, useContext, useState } from "react";

interface AppContextType {
  config: AppConfig;
  setConfig: (
    config: AppConfig | ((prevConfig: AppConfig) => AppConfig),
  ) => void;
  overlayMode: OverlayMode;
  openOverlay: (mode: OverlayMode) => void;
  closeOverlay: () => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{
  initialConfig: AppConfig;
  children: ReactNode;
}> = ({ initialConfig, children }) => {
  const [config, setConfig] = useState<AppConfig>(initialConfig);
  const { overlayMode, openOverlay, closeOverlay } = useOverlayManager();

  const value = {
    config,
    setConfig,
    overlayMode,
    openOverlay,
    closeOverlay,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

export const useAppContext = () => {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error("useAppContext must be used within an AppProvider");
  }
  return context;
};
