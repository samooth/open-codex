 1. Parallel Execution
  Currently, if a model outputs multiple tool calls (e.g., reading three different files), the CLI executes them sequentially in a for loop.
   * Improvement: Use Promise.all to execute independent tool calls in parallel, significantly reducing wait times for multi-step information gathering.

  2. Streaming Tool Extraction
  Right now, the CLI waits for the model to finish its entire response (finish_reason: "stop") before it attempts to extract tool calls from the content.
   * Improvement: Implement "eager" parsing that detects and starts preparing tool calls as soon as a complete JSON object is detected in the stream. This would
     allow the CLI to ask for user approval while the model is still typing its summary.

  3. Interactive/Streaming Command Output
  For long-running commands (like npm install or a complex build), the CLI currently waits for the command to finish before showing any output to the model or user.
   * Improvement: Stream the stdout of the tool back to the UI in real-time, even before sending the final result to the LLM.

  4. Advanced Format Support
  Models often use varied formats beyond standard JSON.
   * Improvement: Support Markdown Code Blocks specifically tagged as tools (e.g.,  ``bash  or  ``json  blocks). Many models are trained to be more reliable when
     wrapping structured data in backticks.

  5. Schema Validation with Zod
  The current parsing logic manually checks for cmd or patch properties.
   * Improvement: Use a library like zod to define strict schemas for tool calls. This would provide the model with much more precise error messages when it
     hallucinates arguments (e.g., "Expected an array of strings for 'command', but received a single string").

  6. Provider-Specific Prompting
  Ollama models, OpenAI models, and Gemini models all have different strengths in tool use.
   * Improvement: Detect the provider (e.g., ollama) and automatically append a specialized "formatting guide" to the system prompt that matches that provider's
     best-performing tool syntax.

  7. Circular Dependency Detection
  If a model keeps calling the same failing tool repeatedly:
   * Improvement: Add a "loop protector" that detects repetitive tool calls with the same arguments and interjects to ask the user for help or suggests a different
     approach.
