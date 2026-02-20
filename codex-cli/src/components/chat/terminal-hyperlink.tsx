import React from "react";
import { Text } from "ink";

/**
 * Renders a terminal-native hyperlink using OSC 8 escape sequences.
 * This allows Cmd/Ctrl + Click to open the link in modern terminals.
 */
export function TerminalHyperlink({
  url,
  children,
  fallback = true,
  color = "cyanBright",
}: {
  url: string;
  children: React.ReactNode;
  fallback?: boolean;
  color?: string;
}) {
  const isTTY = process.stdout.isTTY;

  if (!isTTY) {
    return <>{children}</>;
  }

  const osc8Start = `\x1b]8;;${url}\x1b`;
  const osc8End = `\x1b]8;;\x1b`;

  return (
    <Text color={color}>
      {osc8Start}
      {children}
      {osc8End}
    </Text>
  );
}

/**
 * Creates a file:// URL for a path, absolute or relative.
 */
export function getFileUrl(filePath: string): string {
  if (filePath.startsWith("file://")) return filePath;
  const absolutePath = filePath.startsWith("/")
    ? filePath
    : `${process.cwd()}/${filePath}`;
  return `file://${absolutePath}`;
}
