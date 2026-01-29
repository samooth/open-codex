1. Streaming Tool Extraction
  Right now, the CLI waits for the model to finish its entire response (finish_reason: "stop") before it attempts to extract tool calls from the content.
   * Improvement: Implement "eager" parsing that detects and starts preparing tool calls as soon as a complete JSON object is detected in the stream. This would
     allow the CLI to ask for user approval while the model is still typing its summary.

2. Interactive/Streaming Command Output
  For long-running commands (like npm install or a complex build), the CLI currently waits for the command to finish before showing any output to the model or user.
   * Improvement: Enhance the real-time streaming of stdout back to the UI, ensuring it's always responsive.

3. Provider-Specific Prompting
  Different providers (Ollama, OpenAI, Gemini, Anthropic) have different strengths in tool use.
   * Improvement: Detect the provider and automatically append a specialized "formatting guide" to the system prompt that matches that provider's best-performing tool syntax.

4. Circular Dependency Detection / Loop Protector
  If a model keeps calling the same failing tool repeatedly:
   * Improvement: Add a "loop protector" that detects repetitive tool calls with the same arguments and interjects to ask the user for help or suggests a different approach.

5. Enhanced Sandbox for Linux
  Improve the Linux sandboxing experience beyond the current container-based approach, possibly using Landlock or namespaces directly if available.

6. Plugin System
  Architecture for extending functionality with custom tools and providers without modifying the core agent loop.

---
**Completed Improvements:**
* **Parallel Tool Execution:** Implemented in `handleFunctionCall` using `Promise.all` for faster multi-gather turns.
* **Parallel File Indexing:** Asynchronous recursive file indexing in `getFileContents` and `handleListFilesRecursive`.
* **Advanced Format Support:** Supported Markdown blocks and raw JSON fallback.
* **Schema Validation:** Strictly enforced tool arguments using Zod.