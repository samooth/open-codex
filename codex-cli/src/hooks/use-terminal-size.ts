import { useTerminalSizeContext } from "../contexts/terminal-size-context";

export function useTerminalSize(): { columns: number; rows: number } {
  // This hook now simply returns the context value. The provider handles the logic.
  return useTerminalSizeContext();
}
