import fs from "fs";
import { Box, Text } from "ink";
import React, { useMemo } from "react";

/**
 * Renders an image in the terminal using native graphics protocols if supported.
 * Supports iTerm2, Kitty, and WezTerm.
 */
export function TerminalImage({
  path,
  width = "auto",
  height = "auto",
}: {
  path: string;
  width?: number | "auto";
  height?: number | "auto";
}) {
  const isTTY = process.stdout.isTTY;
  const term = process.env.TERM_PROGRAM || "";
  const isKitty = process.env.TERM === "xterm-kitty";
  const isITerm = term === "iTerm.app";
  const isWezTerm = term === "WezTerm";

  const imageBase64 = useMemo(() => {
    if (!isTTY || (!isKitty && !isITerm && !isWezTerm)) return null;
    try {
      if (!fs.existsSync(path)) return null;
      return fs.readFileSync(path).toString("base64");
    } catch {
      return null;
    }
  }, [path, isTTY, isKitty, isITerm, isWezTerm]);

  if (!imageBase64) {
    return <Text dimColor>[Image: {path}]</Text>;
  }

  // iTerm2 Graphics Protocol
  if (isITerm || isWezTerm) {
    const oscImage = `\x1b]1337;File=name=${Buffer.from(path).toString(
      "base64",
    )};inline=1;width=${width};height=${height}:${imageBase64}\x07`;
    return <Text>{oscImage}</Text>;
  }

  // Kitty Graphics Protocol (simplified)
  if (isKitty) {
    // Kitty uses a more complex chunked protocol, but for small images we can use a simpler one
    // This is a placeholder for a more robust kitty implementation
    return <Text dimColor>[Image (Kitty): {path}]</Text>;
  }

  return <Text dimColor>[Image: {path}]</Text>;
}
