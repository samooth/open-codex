import path from "path";

export function shortenPath(p: string, maxLength = 40): string {
  const home = process.env["HOME"];
  // Replace home directory with '~' if applicable.
  const displayPath =
    home !== undefined && p.startsWith(home) ? p.replace(home, "~") : p;
  if (displayPath.length <= maxLength) {
    return displayPath;
  }

  const parts = displayPath.split(path.sep);
  let result = "";
  for (let i = parts.length - 1; i >= 0; i--) {
    const candidate = path.join("~", "...", ...parts.slice(i));
    if (candidate.length <= maxLength) {
      result = candidate;
    } else {
      break;
    }
  }
  return result || displayPath.slice(-maxLength);
}

export function shortCwd(maxLength = 40): string {
  return shortenPath(process.cwd(), maxLength);
}

/**
 * Middle-truncate a string keeping head and tail (best for file paths —
 * the filename and the root context stay visible). Falls back to the
 * original when it already fits.
 */
export function truncateMiddle(value: string, maxLength: number): string {
  if (value.length <= maxLength || maxLength < 5) {
    return value;
  }
  const half = Math.floor((maxLength - 1) / 2);
  return `${value.slice(0, half)}…${value.slice(value.length - half)}`;
}

/**
 * End-truncate a string (best for model names and identifiers where the
 * meaningful suffix/version lives at the end).
 */
export function truncateEnd(value: string, maxLength: number): string {
  if (value.length <= maxLength || maxLength < 5) {
    return value;
  }
  return `${value.slice(0, maxLength - 1)}…`;
}
