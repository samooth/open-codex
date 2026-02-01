import { useEffect, useState } from "react";

const TERMINAL_PADDING_X = 8;

let globalSize = {
  columns: (process.stdout.columns || 60) - TERMINAL_PADDING_X,
  rows: process.stdout.rows || 20,
};

const listeners = new Set<(size: { columns: number; rows: number }) => void>();

function updateGlobalSize() {
  globalSize = {
    columns: (process.stdout.columns || 60) - TERMINAL_PADDING_X,
    rows: process.stdout.rows || 20,
  };
  for (const listener of listeners) {
    listener(globalSize);
  }
}

let isListening = false;

function ensureListening() {
  if (isListening) return;
  process.stdout.on("resize", updateGlobalSize);
  isListening = true;
}

export function useTerminalSize(): { columns: number; rows: number } {
  const [size, setSize] = useState(globalSize);

  useEffect(() => {
    ensureListening();
    listeners.add(setSize);
    return () => {
      listeners.delete(setSize);
      // We keep the process listener alive as long as the app is running
      // to avoid repeatedly adding/removing it.
    };
  }, []);

  return size;
}