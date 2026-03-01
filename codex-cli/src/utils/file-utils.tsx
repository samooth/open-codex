export function getFileExtension(filePath: string): string | undefined {
  const lastDotIndex = filePath.lastIndexOf(".");
  if (lastDotIndex === -1 || lastDotIndex === 0) {
    return undefined; // No extension or hidden file (e.g., .env)
  }
  return filePath.slice(lastDotIndex + 1);
}
