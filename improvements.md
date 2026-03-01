Here is a list of the improvements I have made:

- Removed duplicate and unnecessary files, making the project cleaner and easier to navigate.
- Standardized the formatting scripts, ensuring consistent code style across the entire project.
- Formatted most of the files in the project, improving code readability.

Here is a list of things that still need to be done:

- Resolve the `npm install` issue. I have tried cleaning the npm cache, but the issue persists. The process is being terminated with a SIGTERM signal, which suggests an environment-specific issue (e.g., running out of memory). Possible solutions to investigate:
  - Increase the memory available to the node process.
  - Use a different version of node or npm.
  - Investigate if any specific dependency is causing a memory leak during installation.
- Update all outdated dependencies.
- Updating ESLint and related packages to version 10 is blocked by `eslint-plugin-react`, which does not yet support ESLint 10.
- Run the linter and fix any issues.
- Run the tests and fix any issues.
