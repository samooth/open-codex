import React, { createContext, useContext, useEffect, useState } from "react";

const TERMINAL_PADDING_X = 8;

type TerminalSize = {
  columns: number;
  rows: number;
};

const TerminalSizeContext = createContext<TerminalSize>({
  columns: (process.stdout.columns || 60) - TERMINAL_PADDING_X,
  rows: process.stdout.rows || 20,
});

export const TerminalSizeProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [size, setSize] = useState<TerminalSize>({
    columns: (process.stdout.columns || 60) - TERMINAL_PADDING_X,
    rows: process.stdout.rows || 20,
  });

  useEffect(() => {
    const onResize = () => {
      setSize({
        columns: (process.stdout.columns || 60) - TERMINAL_PADDING_X,
        rows: process.stdout.rows || 20,
      });
    };

    process.stdout.on("resize", onResize);
    return () => {
      process.stdout.off("resize", onResize);
    };
  }, []);

  return (
    <TerminalSizeContext.Provider value={size}>
      {children}
    </TerminalSizeContext.Provider>
  );
};

export const useTerminalSizeContext = () => useContext(TerminalSizeContext);
