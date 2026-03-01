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

### Specific Issues Found in `@codex-cli/`

1. **TypeScript Errors (Blocking `npm run typecheck`)**:
   - `src/components/chat/terminal-chat.tsx`: Multiple missing type definitions (e.g. `ChatCompletionMessageParam` is missing, should use `ExtendedChatCompletionMessageParam`), implicit `any` types for parameters `c` and `tc`, and unused variables (`MessageStatus`).
   - `src/components/chat/semantic-diff.tsx`: Type `HighlightOptions` doesn't support the `trim` property. Implicit `any` type for `part`.
   - `src/components/chat/terminal-chat-input-thinking.tsx`: Unused variable `isStreamingResponse`.
   - `src/components/chat/terminal-chat-response-item.tsx`: Unused variables `loading` and `status`.

2. **Failing Tests (Vitest)**:
   - Several UI tests in `codex-cli/tests/` (e.g., `multiline-terminal-quirks.test.tsx`, `multiline-history-behavior.test.tsx`, `multiline-growth.test.tsx`, `multiline-enter-submit-cr.test.tsx`) are failing consistently. This appears to be due to testing environment issues, mocked contexts not being properly provided (e.g., `useAppContext must be used within AppProvider`), and Ink's standard test setup failing on mocked streams (`stdin.ref is not a function`).

3. **Dependency Version Discrepancies**:
   - `prettier`: The root `package.json` was updated to use `^3.5.3` and runs across the whole repo, but `codex-cli/package.json` still specifies `"prettier": "^2.8.7"`. This inconsistency might lead to format conflicts or unexpected CLI behaviors when run inside vs outside the workspace.
