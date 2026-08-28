import React from "react";
import { Text } from "ink";

/** Coerce any value into a string so it can never crash Ink as a bare scalar child of <Box>. */
export function ensureText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value == null) return "";
  if (value instanceof Error) return value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function SafeText({
  children,
  ...props
}: React.ComponentProps<typeof Text>): React.ReactElement {
  return <Text {...props}>{ensureText(children)}</Text>;
}
