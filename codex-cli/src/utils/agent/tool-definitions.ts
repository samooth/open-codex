import type { ChatCompletionTool } from "openai/resources/chat/completions.mjs";

export const tools: Array<ChatCompletionTool> = [
  {
    type: "function",
    function: {
      name: "apply_patch",
      description: "Applies a unified diff patch to the codebase.",
      strict: false,
      parameters: {
        type: "object",
        properties: {
          patch: {
            type: "string",
            description:
              "The patch to apply, in unified diff format, wrapped in *** Begin Patch and *** End Patch markers.",
          },
        },
        required: ["patch"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "repo_browser.exec",
      description: "Alias for shell command execution. Use `bash -c` to chain commands.",
      strict: false,
      parameters: {
        type: "object",
        properties: {
          command: { type: "array", items: { type: "string" } },
          cmd: { type: "array", items: { type: "string" } },
          workdir: {
            type: "string",
            description: "The working directory for the command.",
          },
          timeout: {
            type: "number",
            description:
              "The maximum time to wait for the command to complete in milliseconds.",
          },
        },
        required: [],
        additionalProperties: true,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "repo_browser.read_file_lines",
      description: "Alias for read_file_lines.",
      strict: false,
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          start_line: { type: "number" },
          end_line: { type: "number" },
        },
        required: ["path", "start_line", "end_line"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "repo_browser.read_file<|channel|>commentary",
      description: "Alias for read_file (legacy support).",
      strict: false,
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "repo_browser.open_file<|channel|>commentary",
      description: "Alias for read_file.",
      strict: false,
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "repo_browser.open_file",
      description: "Alias for read_file.",
      strict: false,
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "repo_browser.read_file",
      description: "Alias for read_file.",
      strict: false,
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "repo_browser.cat",
      description: "Alias for read_file.",
      strict: false,
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "repo_browser.write_file<|channel|>commentary",
      description: "Alias for write_file.",
      strict: false,
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "repo_browser.write_file",
      description: "Alias for write_file.",
      strict: false,
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "repo_browser.list_directory<|channel|>commentary",
      description: "Alias for list_directory.",
      strict: false,
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "repo_browser.print_tree",
      description: "Alias for list_files_recursive.",
      strict: false,
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "repo_browser.list_directory",
      description: "Alias for list_directory.",
      strict: false,
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "repo_browser.ls<|channel|>commentary",
      description: "Alias for list_directory.",
      strict: false,
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "repo_browser.ls",
      description: "Alias for list_directory.",
      strict: false,
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "repo_browser.search<|channel|>commentary",
      description: "Alias for search_codebase.",
      strict: false,
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string" },
          query: { type: "string" },
          path: { type: "string" },
        },
        required: [],
        additionalProperties: true,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "repo_browser.search",
      description: "Alias for search_codebase.",
      strict: false,
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string" },
          query: { type: "string" },
          path: { type: "string" },
        },
        required: [],
        additionalProperties: true,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "shell",
      description:
        "Runs a single shell command and returns its output. To run multiple commands, chain them with `bash -c 'cmd1 && cmd2'`.",
      strict: false,
      parameters: {
        type: "object",
        properties: {
          command: { type: "array", items: { type: "string" } },
          cmd: { type: "array", items: { type: "string" } },
          workdir: {
            type: "string",
            description: "The working directory for the command.",
          },
          timeout: {
            type: "number",
            description:
              "The maximum time to wait for the command to complete in milliseconds.",
          },
        },
        required: [],
        additionalProperties: true,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_codebase",
      description:
        "Searches the codebase using ripgrep and returns results in a structured JSON format. If pattern starts with '*' (e.g. *.ts) and no query is provided, it lists all matching files.",
      strict: false,
      parameters: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description: "The regex pattern to search for.",
          },
          path: {
            type: "string",
            description: "Optional subdirectory to search within (default: root).",
          },
          include: {
            type: "string",
            description: "Optional glob pattern for files to include (e.g., '*.ts').",
          },
        },
        required: ["pattern"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "persistent_memory",
      description:
        "Saves a fact about the project to a local file that will be injected into future sessions. Useful for project-specific details like ports, architecture choices, or common paths.",
      strict: false,
      parameters: {
        type: "object",
        properties: {
          fact: {
            type: "string",
            description: "The fact to remember (e.g., 'The frontend runs on port 3000').",
          },
          category: {
            type: "string",
            description:
              "Optional category for the fact (e.g., 'architecture', 'dev-setup', 'api').",
          },
        },
        required: ["fact"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_memory",
      description: "Searches the project memory for specific facts using a search query.",
      strict: false,
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query to find relevant facts in memory.",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "forget_memory",
      description: "Removes facts from the project memory that match a specific search pattern or text.",
      strict: false,
      parameters: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description: "The text or regex pattern to identify facts to be removed.",
          },
        },
        required: ["pattern"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "maintain_memory",
      description: "Performs automated maintenance on the project memory. It identifies and merges duplicates, resolves contradictions, and removes outdated information using the LLM.",
      strict: false,
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file_lines",
      description:
        "Reads specific line ranges from a file. Useful for large files to avoid exceeding context limits.",
      strict: false,
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "The path to the file to read.",
          },
          start_line: {
            type: "number",
            description: "The 1-based starting line number (aliases: start, line_start).",
          },
          end_line: {
            type: "number",
            description: "The 1-based ending line number inclusive (aliases: end, line_end).",
          },
        },
        required: ["path", "start_line", "end_line"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_files_recursive",
      description:
        "Returns a tree-view structure of the project files. Useful for understanding project layout.",
      strict: false,
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "The directory to list (default: root).",
          },
          depth: {
            type: "number",
            description: "Maximum depth to recurse (default: 3).",
          },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "summarize_memory",
      description:
        "Retrieves all stored facts from the project memory for review and summarization. Useful when the memory becomes too large.",
      strict: false,
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Reads the full content of a file.",
      strict: false,
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "The path to the file to read.",
          },
        },
        required: ["path"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description:
        "Writes content to a file, creating any parent directories as needed. Overwrites if the file already exists.",
      strict: false,
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "The path to the file to write.",
          },
          content: {
            type: "string",
            description: "The content to write to the file.",
          },
        },
        required: ["path", "content"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_file",
      description: "Deletes a file from the codebase.",
      strict: false,
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "The path to the file to delete.",
          },
        },
        required: ["path"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "repo_browser.rm",
      description: "Alias for delete_file.",
      strict: false,
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "The path to the file to delete.",
          },
        },
        required: ["path"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_directory",
      description: "Lists the contents of a directory (non-recursive).",
      strict: false,
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "The directory to list (default: current working directory).",
          },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "fetch_url",
      description: "Fetches the text content of a URL using the lynx browser.",
      strict: false,
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The URL to fetch.",
          },
        },
        required: ["url"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description: "Performs a web search using DuckDuckGo and returns the results as text.",
      strict: false,
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query.",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "semantic_search",
      description: "Searches the codebase using natural language (semantic search). Requires the codebase to be indexed.",
      strict: false,
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query in natural language.",
          },
          limit: {
            type: "number",
            description: "Maximum number of results to return (default: 5).",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "index_codebase",
      description: "Indexes the current codebase to enable semantic search. This is required before using semantic_search.",
      strict: false,
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "npm_search",
      description: "Searches the npm registry for packages or gets detailed information about a specific package. Use this to find the latest version or dependencies of a package.",
      strict: false,
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query or package name.",
          },
          detailed: {
            type: "boolean",
            description: "If true, retrieves detailed information (version, dependencies) for a specific package instead of searching.",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
];
