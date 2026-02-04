export type Recipe = {
  name: string;
  description: string;
  prompt: string;
};

export const recipes: Recipe[] = [
  {
    name: "Unit Test Generator",
    description: "Generates comprehensive unit tests for the specified file.",
    prompt: "Generate comprehensive unit tests for the current file or specified path. Use the existing testing framework and style guidelines. Ensure edge cases are covered.",
  },
  {
    name: "Documentation Writer",
    description: "Adds JSDoc/TSDoc comments and high-level documentation.",
    prompt: "Analyze the code and add clear, concise TSDoc/JSDoc comments to all public functions and classes. Also, generate or update a README.md section explaining this module's purpose and usage.",
  },
  {
    name: "Security Auditor",
    description: "Scans for common security vulnerabilities and best practice violations.",
    prompt: "Perform a security audit of this module. Look for common vulnerabilities (e.g., injection, insecure dependencies, sensitive data leaks) and suggest mitigations following best practices.",
  },
  {
    name: "Refactor Expert",
    description: "Suggests architectural improvements and cleans up code smells.",
    prompt: "Review the code for smells, redundancy, and architectural issues. Propose and implement a refactored version that improves readability, maintainability, and follows SOLID principles.",
  },
  {
    name: "Bug Hunter",
    description: "Identifies potential logic bugs and edge case failures.",
    prompt: "Deeply analyze the logic of this component. Identify potential bugs, race conditions, or edge cases that are not currently handled. Propose fixes for each issue found.",
  },
  {
    name: "Performance Optimizer",
    description: "Identifies bottlenecks and suggests faster alternatives.",
    prompt: "Profile the code mentally and identify potential performance bottlenecks. Suggest and implement optimizations to reduce execution time and memory usage.",
  },
];
