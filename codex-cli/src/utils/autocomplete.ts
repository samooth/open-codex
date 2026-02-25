
export type FileSearchMatch = {
  query: string;
  startIndex: number;
};

/**
 * Detects if the user is typing a file path trigger ("@").
 * 
 * Logic:
 * - Must contain "@".
 * - "@" must be at the start of the string OR preceded by a delimiter (space, bracket, quote, etc).
 * - Characters AFTER "@" must NOT contain delimiters (space, closing bracket, quote) which would indicate
 *   the user has finished typing the filename or is typing something else.
 */
export function getFileSearchMatch(input: string): FileSearchMatch | null {
  const lastAt = input.lastIndexOf("@");
  if (lastAt === -1) {return null;}
  
  // Ensure it's either at the start or preceded by a space/bracket/quote/etc
  const prevChar = lastAt > 0 ? input[lastAt - 1] : "";
  if (lastAt > 0 && prevChar && !/[\s(\[{"'<=]/.test(prevChar)) {return null;}

  const afterAt = input.slice(lastAt + 1);
  
  // If there is a space or other delimiter after the @, we consider it finished.
  if (/[\s)\]}"'>]/.test(afterAt)) {return null;}

  return { query: afterAt, startIndex: lastAt };
}

/**
 * Filters and sorts a list of files based on a query.
 */
export function filterFiles(allFiles: Array<string>, query: string, limit: number = 10): Array<string> {
  if (!allFiles) {return [];}
  const q = query.toLowerCase();
  
  return allFiles
    .filter((f) => f.toLowerCase().includes(q))
    .sort((a, b) => {
      // Boost files that start with the query
      const aStart = a.toLowerCase().startsWith(q);
      const bStart = b.toLowerCase().startsWith(q);
      if (aStart && !bStart) {return -1;}
      if (!aStart && bStart) {return 1;}
      return a.localeCompare(b);
    })
    .slice(0, limit);
}
