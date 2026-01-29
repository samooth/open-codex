  Potential Improvements:

   1. Tool-Specific Advice:
       * Explicitly mention the new parallel execution capability. If the model needs information from multiple files, it should call multiple read_file tools in one turn to save time.
       * Encourage using read_file_lines for files over a certain size (e.g., > 500 lines) to preserve context window.

   2. Dry-Run Awareness:
       * Tell the agent about the --dry-run flag. If it's active (which we can inject into the prompt), the agent should know its changes won't be committed and it might need to explain
         its reasoning more thoroughly.

   3. Provider-Specific Formatting:
       * As noted in TODO.md, different models (Ollama vs. OpenAI vs. Gemini) prefer different tool-calling syntaxes. We could dynamically append a "best practices" section based on the
         active provider.

   4. Loop Protection Strategy:
       * Instruct the agent that if a command fails more than twice with the same error, it should stop and ask for clarification instead of retrying blindly.

   5. Structured Planing:
       * For complex tasks, encourage the model to output a <plan> block before executing, helping the user (and the model) track milestones.

   6. Knowledge of the "Project Memory":
       * Remind the agent that it can save important facts using the persistent_memory tool so it doesn't have to re-discover them in future sessions.

