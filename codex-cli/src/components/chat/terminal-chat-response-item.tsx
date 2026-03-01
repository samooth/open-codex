import type { GroupedResponseItem } from "./use-message-grouping.js";
import type { CommandReviewDetails } from "../../utils/parsers";
import type { Theme } from "../../utils/theme.js";
import type { TerminalRendererOptions } from "marked-terminal";
import type {
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
} from "openai/resources/chat/completions.mjs";
import type { ResponseReasoningItem } from "openai/resources/responses/responses";
import type { ExtendedChatCompletionMessageParam, MessageStatus } from "../../app";

import { TerminalImage } from "./terminal-image.js";
import { formatCommandForDisplay } from "../../format-command.js";
import { useTerminalSize } from "../../hooks/use-terminal-size";
import {
  TOOL_APPLY_PATCH,
  TOOL_SHELL,
} from "../../utils/agent/tool-constants.js";
import {
  parseToolCallOutput,
  parseToolCallArguments,
} from "../../utils/parsers";
import { getSyntaxTheme } from "../../utils/theme.js";
import Spinner from "../vendor/ink-spinner.js";
import chalk, { type ForegroundColorName } from "chalk";
import { highlight as syntaxHighlight } from "cli-highlight";
import { Box, Text, useInput } from "ink";
import { parse } from "marked";
import TerminalRenderer from "marked-terminal";
import { fileURLToPath } from "node:url";
import React, { useMemo, useState } from "react";
import { useInterval } from "use-interval";

export function getCommandReviewDetails(
  toolCall: ChatCompletionMessageToolCall,
): CommandReviewDetails | undefined {
  if (!toolCall || toolCall.type !== "function" || !toolCall.function) {
    return undefined;
  }

  const result = parseToolCallArguments(toolCall.function.arguments);
  if (!result.success) {
    return {
      cmd: [],
      cmdReadableText: toolCall.function.arguments,
    };
  }

  if (!result.multiCall && result.args) {
    const cmd = result.args.cmd;
    if (cmd) {
      const cmdReadableText = formatCommandForDisplay(cmd);
      return {
        cmd,
        cmdReadableText,
      };
    }
  }

  return {
    cmd: [],
    cmdReadableText: `${toolCall.function.name} ${toolCall.function.arguments}`,
  };
}

/**
 * A lightweight alternative to the full Markdown component.
 * Used during streaming to avoid the overhead of a full Markdown parser (marked)
 * on every single token chunk.
 */
export const LiteMarkdown = React.memo(function LiteMarkdown({
  children,
  theme,
}: {
  children: string;
  theme: Theme;
}) {
  const [frameCount, setFrameCount] = useState(0);

  // Subtle animation for streaming "pulse"
  useInterval(() => {
    setFrameCount((f) => f + 1);
  }, 100);

  const parts = useMemo(() => {
    const regex = /```(\w+)?\n([\s\S]*?)(?:```|$)/g;
    const result: Array<{
      type: "text" | "code";
      content: string;
      lang?: string;
    }> = [];
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(children)) !== null) {
      if (match.index > lastIndex) {
        result.push({
          type: "text",
          content: children.slice(lastIndex, match.index),
        });
      }
      result.push({ type: "code", lang: match[1], content: match[2]! });
      lastIndex = regex.lastIndex;
    }

    if (lastIndex < children.length) {
      result.push({ type: "text", content: children.slice(lastIndex) });
    }

    return result;
  }, [children]);

  return (
    <Box flexDirection="column" width="100%">
      {parts.map((part, i) => {
        if (part.type === "code") {
          return (
            <Box
              key={i}
              flexDirection="column"
              borderStyle="bold"
              borderRight={false}
              borderTop={false}
              borderBottom={false}
              borderLeftColor={theme.accent}
              paddingLeft={2}
              marginY={1}
              width="100%"
            >
              <Box justifyContent="space-between" marginBottom={0}>
                <Text color={theme.accent} bold italic>
                  {part.lang?.toUpperCase() || "CODE"}
                </Text>
              </Box>
              <Text>{part.content}</Text>
            </Box>
          );
        }

        // Highlight the "tail" of the text to simulate a pulse/glow during streaming
        const content = part.content;
        const tailSize = 10;
        if (content.length > tailSize && frameCount % 2 === 0) {
          const head = content.slice(0, -tailSize);
          const tail = content.slice(-tailSize);
          return (
            <Text key={i}>
              {head}
              <Text color={theme.highlight} bold>
                {tail}
              </Text>
            </Text>
          );
        }

        return <Text key={i}>{content}</Text>;
      })}
    </Box>
  );
});

export type MarkdownProps = TerminalRendererOptions & {
  children: string;
  isActive?: boolean;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
};

export function Markdown({
  children,
  theme,
  isActive = false,
  isCollapsed = false,
  onToggleCollapse,
  ...options
}: MarkdownProps & { theme: Theme }): React.ReactElement {
  const size = useTerminalSize();

  const contentToRender = useMemo(() => {
    if (isCollapsed) {
      const lines = children.split("\n");
      const head = lines.slice(0, 5).join("\n");
      return `${head}\n... (collapsed, ${lines.length - 5} more lines)`;
    }
    return children;
  }, [children, isCollapsed]);

  const renderedParts = React.useMemo(() => {
    try {
      const renderer = new TerminalRenderer({
        ...options,
        width: Math.max(size.columns - 4, 20),
        tab: 2,
        highlight: (code: string, lang: string) => {
          try {
            return syntaxHighlight(code, {
              language: lang,
              ignoreIllegals: true,
              theme: getSyntaxTheme(theme),
            });
          } catch {
            return code;
          }
        },
        // Enhanced styling
        heading:
          chalk[theme.assistant as ForegroundColorName]?.bold || chalk.bold,
        firstHeading:
          chalk[theme.assistant as ForegroundColorName]?.bold?.underline ||
          chalk.bold.underline,
        strong: chalk.bold,
        em: chalk.italic,
        codespan: chalk.cyan,
        link: chalk.cyanBright.underline,
        href: chalk.cyanBright.underline,
        code: chalk.reset,
        tableOptions: {
          style: {
            head: [theme.highlight, "bold"],
            border: [theme.dim],
          },
        },
      } as any);

      const parsed = parse(children, {
        async: false,
        gfm: true,
        breaks: true,
        renderer: renderer as any,
      });

      if (typeof parsed !== "string" || !parsed) {
        return [{ type: "text", content: children }];
      }

      // 1. Identify and extract code blocks before generic markdown processing
      // This regex looks for fenced code blocks in the original markdown
      const codeBlockRegex = /```(\w+)?\n([\s\S]*?)(?:```|$)/g;
      const codeBlocks: Array<{
        lang: string;
        content: string;
        placeholder: string;
      }> = [];
      let codeMatch;
      let tempMarkdown = children;
      let placeholderIndex = 0;

      while ((codeMatch = codeBlockRegex.exec(children)) !== null) {
        const lang = codeMatch[1] || "code";
        const content = codeMatch[2]!;
        const placeholder = `CID_CB_PLACEHOLDER_${placeholderIndex}`;

        // Render the code block content with syntax highlighting now
        let renderedCode = content;
        try {
          renderedCode = syntaxHighlight(content, {
            language: lang,
            ignoreIllegals: true,
            theme: getSyntaxTheme(theme),
          });
        } catch {
          /* use raw */
        }

        codeBlocks.push({ lang, content: renderedCode, placeholder });
        // Replace the whole block in original markdown with a placeholder
        tempMarkdown = tempMarkdown.replace(codeMatch[0], placeholder);
        placeholderIndex++;
      }

      // 2. Render the markdown (with placeholders) via TerminalRenderer
      const renderedMarkdown = parse(tempMarkdown, {
        async: false,
        gfm: true,
        breaks: true,
        renderer: renderer as any,
      });

      if (typeof renderedMarkdown !== "string") {
        return [{ type: "text", content: children }];
      }

      // Enhanced Task List Rendering
      const taskListFixed = renderedMarkdown
        .replace(
          /^[ \t]*[*+-][ \t]+\[x\][ \t]+/gim,
          chalk[theme.success as ForegroundColorName]("✅ "),
        )
        .replace(
          /^[ \t]*[*+-][ \t]+\[ \][ \t]+/gim,
          chalk[theme.dim as ForegroundColorName]("⬜ "),
        )
        .replace(
          /(\n)[ \t]{2,}[*+-][ \t]+\[x\][ \t]+/gim,
          `$1  ${chalk[theme.success as ForegroundColorName]("✅ ")}`,
        )
        .replace(
          /(\n)[ \t]{2,}[*+-][ \t]+\[ \][ \t]+/gim,
          `$1  ${chalk[theme.dim as ForegroundColorName]("⬜ ")}`,
        );

      // 3. Split the rendered text back into parts by finding our placeholders
      const parts: Array<{
        type: "text" | "code";
        content: string;
        lang?: string;
      }> = [];

      // Use a regex to split by any of our placeholders
      const placeholderRegex = /CID_CB_PLACEHOLDER_(\d+)/g;
      let lastIndex = 0;
      let pMatch;

      while ((pMatch = placeholderRegex.exec(taskListFixed)) !== null) {
        if (pMatch.index > lastIndex) {
          parts.push({
            type: "text",
            content: taskListFixed.slice(lastIndex, pMatch.index),
          });
        }

        const idx = parseInt(pMatch[1]!, 10);
        const cb = codeBlocks[idx];
        if (cb) {
          parts.push({ type: "code", lang: cb.lang, content: cb.content });
        }

        lastIndex = placeholderRegex.lastIndex;
      }

      if (lastIndex < taskListFixed.length) {
        parts.push({ type: "text", content: taskListFixed.slice(lastIndex) });
      }

      return parts;
    } catch (e) {
      return [{ type: "text", content: contentToRender }]; // Use contentToRender here
    }
  }, [contentToRender, size.columns, theme]); // Rerender when contentToRender changes

  return (
    <Box flexDirection="column" width="100%">
      {renderedParts.map((part: any, i) => {
        if (part.type === "code") {
          return (
            <Box
              key={i}
              flexDirection="column"
              borderStyle="bold"
              borderRight={false}
              borderTop={false}
              borderBottom={false}
              borderLeftColor={theme.accent}
              paddingLeft={2}
              marginY={1}
              width="100%"
            >
              <Box justifyContent="space-between" marginBottom={0}>
                <Text color={theme.accent} bold italic>
                  {part.lang?.toUpperCase() || "CODE"}
                </Text>
              </Box>
              <Text>{part.content}</Text>
            </Box>
          );
        }
        return <Text key={i}>{part.content}</Text>;
      })}
    </Box>
  );
}

function getToolDisplayInfo(message: ChatCompletionMessageToolCall) {
  const details = getCommandReviewDetails(message);
  const toolName = (message as any)?.function?.name || "";
  const rawArgs = (message as any)?.function?.arguments || "{}";

  let args: any = {};
  try {
    args = JSON.parse(rawArgs);
  } catch {
    // ignore
  }

  let label = "command";
  let icon = "⚙️";
  let color: ForegroundColorName = "cyanBright";
  let summary = details?.cmdReadableText;

  // Semantic mapping for tools
  if (toolName.includes("read_file_lines")) {
    label = "reading lines";
    icon = "📖";
    summary = `${args.path} [${args.start_line}-${args.end_line}]`;
  } else if (toolName.includes("read_file")) {
    label = "reading file";
    icon = "📄";
    summary = args.path;
  } else if (toolName.includes("write_file")) {
    label = "writing file";
    icon = "✍️";
    summary = args.path;
  } else if (toolName.includes("delete_file")) {
    label = "deleting file";
    icon = "🗑️";
    color = "redBright";
    summary = args.path;
  } else if (
    toolName.includes("list_directory") ||
    toolName.includes("list_files")
  ) {
    label = "listing";
    icon = "📂";
    summary = args.path || ".";
  } else if (toolName.includes("search_codebase")) {
    label = "searching";
    icon = "🔍";
    summary = `"${args.pattern || args.query}" ${
      args.path ? `in ${args.path}` : ""
    }`;
  } else if (toolName.includes(TOOL_APPLY_PATCH)) {
    label = "patching";
    icon = "🩹";
    summary = "applying changes";
  } else if (toolName === "web_search") {
    label = "searching web";
    icon = "🌐";
    color = "blueBright";
    summary = `"${args.query}"`;
  } else if (toolName === "fetch_url") {
    label = "fetching web";
    icon = "🌐";
    color = "blueBright";
    summary = args.url;
  } else if (toolName.includes("memory")) {
    label = "memory";
    icon = "🧠";
    color = "cyanBright";
    summary = args.fact || args.query || args.pattern || "maintenance";
  } else if (toolName === TOOL_SHELL) {
    label = "shell";
    icon = "🐚";
    summary = details?.cmdReadableText;
  }

  return { label, icon, color, summary, toolName, details };
}

export const TerminalChatResponseToolCallOutput = React.memo(
  function TerminalChatResponseToolCallOutput({
    content,
    fullStdout,
    toolCall,
    theme,
    isActive = false,
    status,
  }: {
    content: string;
    fullStdout: boolean;
    toolCall?: ChatCompletionMessageToolCall;
    theme: Theme;
    isActive?: boolean;
    status?: MessageStatus;
  }) {
    const { output, metadata } = parseToolCallOutput(content);
    const { exit_code, duration_seconds, type, url, query, aborted } =
      metadata as any;

    const [isCollapsed, setIsCollapsed] = useState(() => {
      if (fullStdout) {
        return false;
      }
      const lines = output.trim().split("\n");
      return lines.length > 10;
    });

    useInput(
      (input, _key) => {
        if (!isActive) {
          return;
        }
        if (input === "c") {
          setIsCollapsed(!isCollapsed);
        }
      },
      { isActive },
    );

    const isDebug =
      process.env["DEBUG"] === "1" || process.env["NODE_ENV"] === "development";
    const isError =
      exit_code !== 0 && typeof exit_code !== "undefined" && !aborted;

    const {
      label: callLabel,
      icon,
      summary,
      toolName,
    } = useMemo(() => {
      if (toolCall) {
        return getToolDisplayInfo(toolCall);
      }
      return {
        label: "command",
        icon: "⚙️",
        summary: "",
        toolName: "",
      };
    }, [toolCall]);

    const metadataInfo = useMemo(
      () =>
        [
          typeof exit_code !== "undefined" ? `code: ${exit_code}` : "",
          typeof duration_seconds !== "undefined"
            ? `duration: ${duration_seconds}s`
            : "",
        ]
          .filter(Boolean)
          .join(", "),
      [exit_code, duration_seconds],
    );

    let label = "STDOUT";
    let labelColor: ForegroundColorName = theme.dim as ForegroundColorName;
    let headerContent: string | undefined;

    if (type === "web_fetch") {
      label = "WEB.FETCH";
      labelColor = theme.highlight;
      headerContent = url;
    } else if (
      type === "web_search" ||
      type === "web_search_serper" ||
      type === "web_search_searxng"
    ) {
      label = "WEB.SEARCH";
      labelColor = theme.highlight;
      headerContent = `query: ${query}`;
    }

    let displayedContent = output.trim();
    const lineCount = displayedContent.split("\n").length;
    const isLargeOutput = lineCount > 10 || displayedContent.length > 9000;

    if (isCollapsed) {
      const lines = displayedContent.split("\n");
      if (lines.length > 10) {
        const head = lines.slice(0, 10);
        const remaining = lines.length - 10;
        displayedContent = [
          ...head,
          chalk.gray(
            `... (${remaining} more lines${isActive ? ", press 'c' to expand" : ""})`,
          ),
        ].join("\n");
      }
      // Truncate very long outputs
      if (displayedContent.length > 9000) {
        displayedContent =
          displayedContent.slice(0, 9000) +
          chalk.gray(
            `\n... (truncated, ${output.length - 9000} more characters${isActive ? ", press 'c' to expand" : ""})`,
          );
      }
    }

    const colorizedContent = useMemo(() => {
      if (aborted) {
        return chalk.italic.gray("Execution aborted by user.");
      }

      let language: string | undefined;
      if (toolName === "search_codebase" || toolName === "semantic_search") {
        language = "json";
      } else if (
        toolName === "read_file" ||
        toolName === "read_file_lines" ||
        toolName === "write_file"
      ) {
        try {
          const args = JSON.parse(
            (toolCall as any)?.function?.arguments || "{}",
          );
          const filePath = args.path || "";
          const extension = filePath.split(".").pop()?.toLowerCase();
          if (extension) {
            language = extension;
          }
        } catch {
          /* ignore */
        }
      }

      if (language) {
        try {
          return syntaxHighlight(displayedContent, {
            language,
            ignoreIllegals: true,
            theme: getSyntaxTheme(theme),
          });
        } catch {
          /* ignore */
        }
      }

      // Fallback: Check if it looks like a unified diff or our custom patch format
      const isPatch =
        displayedContent.includes("*** Begin Patch") ||
        displayedContent.includes("--- ") ||
        displayedContent.includes("+++ ");

      if (isPatch || toolName === TOOL_APPLY_PATCH) {
        return displayedContent
          .split("\n")
          .map((line) => {
            if (line.startsWith("+") && !line.startsWith("+++")) {
              return chalk[theme.success](line);
            }
            if (line.startsWith("-") && !line.startsWith("---")) {
              return chalk[theme.error](line);
            }
            if (line.startsWith("@@")) {
              return chalk.cyan(line);
            }
            return line;
          })
          .join("\n");
      }

      return displayedContent;
    }, [displayedContent, toolName, JSON.stringify(toolCall), aborted]);

    return (
      <Box
        flexDirection="column"
        gap={0}
        marginY={aborted ? 0 : 1}
        paddingLeft={1}
        borderStyle="bold"
        borderRight={false}
        borderTop={false}
        borderBottom={false}
        borderLeftColor={
          status === 'success'
            ? theme.success
            : status === 'failure'
              ? theme.error
              : isError
                ? theme.error
                : aborted
                  ? theme.dim
                  : theme.divider
        }
      >
        {toolCall && (
          <Box
            gap={1}
            paddingX={1}
            marginBottom={(isDebug || isError) && !aborted ? 1 : 0}
          >
            <Text color={theme.toolIcon} bold>
              {icon}
            </Text>
            <Text color={theme.toolLabel} bold>
              {callLabel.toUpperCase()}
            </Text>
            <Text color={theme.highlight} wrap="wrap">
              {summary}
            </Text>
          </Box>
        )}

        {(isError || isDebug) &&
          !aborted &&
          toolCall &&
          (toolCall as any).function && (
            <Box
              flexDirection="column"
              paddingLeft={3}
              paddingRight={1}
              marginBottom={1}
            >
              <Box gap={1}>
                <Text bold color={theme.dim}>
                  ARGS:
                </Text>
                <Text color={theme.dim} wrap="wrap">
                  {(toolCall as any).function.arguments}
                </Text>
              </Box>
            </Box>
          )}

        {!aborted && (
          <Box gap={1} paddingX={1}>
            <Text color={labelColor} bold wrap="wrap">
              {label}
            </Text>
            <Text color={theme.dim} wrap="wrap">
              {metadataInfo ? `(${metadataInfo})` : ""}
            </Text>
          </Box>
        )}
        {!aborted && headerContent && (
          <Box paddingX={1}>
            <Text italic color="cyanBright" wrap="wrap">
              {headerContent}
            </Text>
          </Box>
        )}
        <Box marginTop={!aborted && displayedContent ? 0 : 0} paddingX={1}>
          <Text
            color={
              !aborted && type !== "web_fetch" && type !== "web_search"
                ? theme.dim
                : undefined
            }
            wrap="wrap"
          >
            {colorizedContent || chalk.italic.gray("(no output)")}
          </Text>
        </Box>
        {!aborted && isLargeOutput && isActive && (
          <Box marginTop={0} paddingX={1} marginBottom={0}>
            <Text color={theme.dim} italic>
              {isCollapsed
                ? `(press 'c' to expand ${lineCount - 10} more lines)`
                : "(press 'c' to collapse)"}
            </Text>
          </Box>
        )}
      </Box>
    );
  },
);

export const TerminalChatResponseToolCall = React.memo(
  function TerminalChatResponseToolCall({
    message,
    loading = false,
    theme,
    status = 'running',
  }: {
    message: ChatCompletionMessageToolCall;
    loading?: boolean;
    theme: Theme;
    status?: MessageStatus;
  }) {
    const { label, icon, summary, toolName, details } = useMemo(
      () => getToolDisplayInfo(message),
      [message],
    );

    const readableText = useMemo(() => {
      let text = details?.cmdReadableText || "";
      // If it's a huge patch or shell command during streaming, truncate it
      // to prevent terminal flickering and massive layout shifts.
      if (status === 'running' && text.length > 500) {
        text = text.slice(0, 500) + "... (streaming)";
      }
      return text;
    }, [details?.cmdReadableText, status]);

    const borderColor = useMemo(() => {
      if (status === 'success') {
        return theme.success;
      } else if (status === 'failure') {
        return theme.error;
      } else {
        return theme.accent;
      }
    }, [status, theme]);

    const textColor = useMemo(() => {
      if (status === 'success') {
        return theme.success;
      } else if (status === 'failure') {
        return theme.error;
      } else {
        return theme.toolIcon;
      }
    }, [status, theme]);

    return (
      <Box
        flexDirection="row"
        gap={1}
        marginY={1}
        paddingLeft={1}
        borderStyle="bold"
        borderRight={false}
        borderTop={false}
        borderBottom={false}
        borderLeftColor={borderColor}
      >
        <Box flexDirection="column" gap={0}>
          <Box gap={1}>
            {status === 'running' ? (
              <Spinner type="dots" color={theme.toolLabel} />
            ) : (
              <Text color={textColor} bold>
                {status === 'success' ? '✅' : status === 'failure' ? '❌' : icon}
              </Text>
            )}
            <Text color={theme.toolLabel} bold>
              {label.toUpperCase()}
            </Text>
            <Text color={theme.highlight} wrap="wrap">
              {summary}
            </Text>
          </Box>
          {(status === 'running' || readableText) &&
            (toolName === TOOL_SHELL || toolName === TOOL_APPLY_PATCH) && (
              <Box paddingLeft={2} marginTop={readableText ? 0 : 0}>
                <Text color={theme.shellCommand}>$ {readableText}</Text>
              </Box>
            )}
        </Box>
      </Box>
    );
  },
);

export const TerminalChatResponseMessage = React.memo(
  function TerminalChatResponseMessage({
    message,
    fullStdout,
    toolCallMap = new Map(),
    theme,
    model,
    showRole = true,
    disableMarkdown = false,
    isActive = false,
    status,
  }: {
    message: ChatCompletionMessageParam;
    fullStdout?: boolean;
    toolCallMap?: Map<string, any>;
    theme: Theme;
    model?: string;
    showRole?: boolean;
    disableMarkdown?: boolean;
    isActive?: boolean;
    status?: MessageStatus;
  }) {
    const [isCollapsed, setIsCollapsed] = useState(false);
    const contentParts: Array<string> = [];
    const imagePaths: Array<string> = [];

    useInput(
      (input, _key) => {
        if (!isActive) {
          return;
        }
        if (input === "c") {
          setIsCollapsed(!isCollapsed);
        }
      },
      { isActive },
    );

    // Capture reasoning content if present (common in models like o1, o3-mini)
    if ((message as any).reasoning_content) {
      contentParts.push(
        `<thought>${(message as any).reasoning_content}</thought>`,
      );
    }

    if (typeof message.content === "string") {
      contentParts.push(message.content);
    } else if (Array.isArray(message.content)) {
      for (const part of message.content) {
        if (part.type === "text") {
          contentParts.push(part.text);
        }
        if (part.type === "refusal") {
          contentParts.push(part.refusal);
        }
        if (part.type === "image_url") {
          const url = (part as any).image_url?.url || "";
          if (url.startsWith("file://")) {
            imagePaths.push(fileURLToPath(url));
          }
          contentParts.push(`<Image />`);
        }
        if (part.type === "file") {
          contentParts.push(`<File />`);
        }
      }
    }
    const content = contentParts.join("");
    const lineCount = content.split("\n").length;
    const isLargeOutput = lineCount > 10 || content.length > 9000;

    if (content.length === 0 && imagePaths.length === 0) {
      return null;
    }
    if (message.role === "tool" && !("tool_calls" in message)) {
      // Find the original tool call that this output corresponds to
      const toolCallId = (message as any).tool_call_id;
      const toolCall = toolCallMap.get(toolCallId);

      return (
        <TerminalChatResponseToolCallOutput
          content={content}
          fullStdout={!!fullStdout}
          toolCall={toolCall}
          theme={theme}
          isActive={isActive}
        />
      );
    }

    // Extract <thought>, <think>, or <plan> blocks (handles mixed and unclosed tags during streaming)
    const thoughts: Array<string> = [];
    const plans: Array<string> = [];

    // Use a more flexible regex that allows mixed closing tags or no closing tag (end of string)
    const thoughtRegex =
      /<(thought|think|thinking)>([\s\S]*?)(?:<\/(?:thought|think|thinking)>|$)/gim;
    const planRegex = /<(plan|roadmap)>([\s\S]*?)(?:<\/(?:plan|roadmap)>|$)/gim;
    const responseTagRegex = /<response>([\s\S]*?)(?:<\/response>|$)/gim;

    let displayContent = content.replace(
      thoughtRegex,
      (_, _tagName, thought) => {
        thoughts.push(thought.trim());
        return "";
      },
    );

    displayContent = displayContent.replace(planRegex, (_, _tagName, plan) => {
      plans.push(plan.trim());
      return "";
    });

    displayContent = displayContent.replace(responseTagRegex, (_, resp) => {
      return resp;
    });

    // Final cleanup: strip any stray unclosed or leftover closing tags
    displayContent = displayContent
      .replace(
        /<\/(thought|think|thinking|plan|roadmap|response)>| <\/(thought|think|thinking|plan|roadmap|response)>/gim,
        "",
      )
      .trim();

    const hasThoughts = thoughts.length > 0;
    const hasPlans = plans.length > 0;
    const hasContent = displayContent.trim().length > 0;
    const hasImages = imagePaths.length > 0;

    const roleColor =
      message.role === "assistant" ? theme.assistant : theme.user;
    const isAssistant = message.role === "assistant";

    if (isCollapsed) {
      return (
        <Box flexDirection="column" paddingLeft={2} marginY={1}>
          <Box gap={1}>
            <Box backgroundColor={roleColor as any} paddingX={1}>
              <Text bold color="black">
                {isAssistant ? " ASSISTANT " : " USER "}
              </Text>
            </Box>
            <Text color={theme.dim} italic>
              (collapsed - press 'c' to expand)
            </Text>
          </Box>
          <Text color={theme.dim} italic>
            {displayContent.slice(0, 100).replace(/\n/g, " ")}
            {displayContent.length > 100 ? "..." : ""}
          </Text>
        </Box>
      );
    }

    return (
      <Box flexDirection="column" paddingLeft={isAssistant ? 0 : 0}>
        {showRole && (hasContent || (!hasThoughts && !hasPlans)) && (
          <Box gap={1} marginBottom={1} marginTop={1}>
            <Box backgroundColor={roleColor as any} paddingX={1}>
              <Text bold color="black">
                {isAssistant ? " ASSISTANT " : " USER "}
              </Text>
            </Box>
            {isAssistant && model && (
              <Text color={theme.dim} italic>
                {model}
              </Text>
            )}
          </Box>
        )}
        {hasImages && (
          <Box flexDirection="row" gap={2} marginY={1}>
            {imagePaths.map((p, i) => (
              <TerminalImage key={i} path={p} width={20} />
            ))}
          </Box>
        )}
        {thoughts.map((thought, i) => (
          <Box
            key={i}
            flexDirection="row"
            gap={1}
            paddingLeft={1}
            borderStyle="bold"
            borderRight={false}
            borderTop={false}
            borderBottom={false}
            borderLeftColor={theme.thought}
            marginTop={hasContent ? 1 : 0}
            marginBottom={1}
          >
            <Box flexDirection="column">
              <Text italic color={theme.thought} bold>
                ( thought )
              </Text>
              <Text italic color={theme.dim}>
                {thought}
              </Text>
            </Box>
          </Box>
        ))}
        {plans.map((plan, i) => (
          <Box
            key={i}
            flexDirection="row"
            gap={1}
            paddingLeft={1}
            borderStyle="bold"
            borderRight={false}
            borderTop={false}
            borderBottom={false}
            borderLeftColor={theme.plan}
            marginTop={1}
            marginBottom={1}
          >
            <Box flexDirection="column">
              <Text bold color={theme.plan}>
                📋 PLAN
              </Text>
              <Markdown theme={theme}>{plan}</Markdown>
            </Box>
          </Box>
        ))}
        {hasContent && (
          <Box flexDirection="column" paddingLeft={2}>
            {isAssistant && isActive && !disableMarkdown && (
              <Box marginBottom={0}>
                <Text color={theme.dim} italic>
                  (press 'c' to collapse)
                </Text>
              </Box>
            )}
            {isAssistant ? (
              disableMarkdown ? (
                <LiteMarkdown theme={theme}>
                  {displayContent.trim()}
                </LiteMarkdown>
              ) : (
                <Markdown
                  theme={theme}
                  isActive={isActive}
                  isCollapsed={isCollapsed}
                  onToggleCollapse={() => setIsCollapsed(!isCollapsed)}
                >
                  {displayContent.trim()}
                </Markdown>
              )
            ) : (
              <Text color={theme.user}>{displayContent.trim()}</Text>
            )}
            {disableMarkdown && (
              <Box gap={1}>
                <Spinner type="dots" color={theme.highlight} />
              </Box>
            )}
            {isAssistant && isLargeOutput && isActive && (
              <Box marginTop={0} paddingX={0} marginBottom={0}>
                <Text color={theme.dim} italic>
                  {isCollapsed
                    ? `(press 'c' to expand ${lineCount - 10} more lines)`
                    : "(press 'c' to collapse)"}
                </Text>
              </Box>
            )}
          </Box>
        )}
      </Box>
    );
  },
);

export function TerminalChatResponseReasoning({
  message,
  theme,
}: {
  message: ResponseReasoningItem & { duration_ms?: number };
  theme: Theme;
}): React.ReactElement | null {
  // prefer the real duration if present
  const thinkingTime = message.duration_ms
    ? Math.round(message.duration_ms / 1000)
    : Math.max(
        1,
        Math.ceil(
          (message.summary || [])
            .map((t) => t.text.length)
            .reduce((a, b) => a + b, 0) / 300,
        ),
      );
  if (thinkingTime <= 0) {
    return null;
  }

  return (
    <Box gap={1} flexDirection="column">
      <Box gap={1}>
        <Text bold color="magenta">
          thinking
        </Text>
        <Text dimColor>for {thinkingTime}s</Text>
      </Box>
      {message.summary?.map((summary, key) => {
        const s = summary as { headline?: string; text: string };
        return (
          <Box key={key} flexDirection="column">
            {s.headline && <Text bold>{s.headline}</Text>}
            <Markdown theme={theme}>{s.text}</Markdown>
          </Box>
        );
      })}
    </Box>
  );
}

function TerminalChatResponseToolBatch({
  group,
  toolCallMap,
  fullStdout,
  theme,
  isActive = false,
}: {
  group: GroupedResponseItem;
  toolCallMap: Map<string, any>;
  fullStdout: boolean;
  theme: Theme;
  isActive?: boolean;
}) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const items = group.items;
  const isLargeBatch = items.length > 3;

  useInput(
    (input, _key) => {
      if (!isActive) {
        return;
      }
      if (input === "c") {
        setIsCollapsed(!isCollapsed);
      }
    },
    { isActive },
  );

  return (
    <Box flexDirection="column" gap={0} marginY={0}>
      <Box gap={1} marginBottom={0} marginLeft={2}>
        <Text color={theme.dim} bold italic>
          batch: {items.length} ops{" "}
          {isActive && `(press 'c' to ${isCollapsed ? "expand" : "collapse"})`}
        </Text>
      </Box>
      {!isCollapsed && (
        <Box flexDirection="column" gap={0}>
          {items.map((item, i) => {
            // Heuristic: If it's a large batch, show a compact summary for early items
            if (isLargeBatch && i < items.length - 3) {
              const toolCallId = (item as any).tool_call_id;
              const toolCall = toolCallMap.get(toolCallId);
              const { icon, label, summary } = toolCall
                ? getToolDisplayInfo(toolCall)
                : { icon: "⚙️", label: "tool", summary: "" };
              const { metadata } = parseToolCallOutput(
                (item as any).content as string,
              );
              const isError =
                metadata.exit_code !== 0 &&
                typeof metadata.exit_code !== "undefined";

              return (
                <Box key={i} gap={1} paddingLeft={2}>
                  <Text color={isError ? theme.error : theme.dim}>
                    {isError ? "❌" : "✅"}
                  </Text>
                  <Text color={theme.dim}>
                    {icon} {label}
                  </Text>
                  <Text color={theme.dim} italic>
                    {summary}
                  </Text>
                </Box>
              );
            }

            return (
              <TerminalChatResponseMessage
                key={i}
                message={item as any}
                fullStdout={fullStdout}
                toolCallMap={toolCallMap}
                theme={theme}
                isActive={isActive}
              />
            );
          })}
        </Box>
      )}
    </Box>
  );
}

function TerminalChatResponseItem({
  item,
  group,
  fullStdout = false,
  toolCallMap = new Map(),
  loading = false,
  theme,
  model,
  showRole = true,
  previousRole,
  isStreaming = false,
  isActive = false,
  status,
}: {
  item?: ExtendedChatCompletionMessageParam;
  group?: GroupedResponseItem;
  fullStdout?: boolean;
  toolCallMap?: Map<string, any>;
  loading?: boolean;
  theme: Theme;
  model: string;
  showRole?: boolean;
  previousRole?: string;
  isStreaming?: boolean;
  isActive?: boolean;
  status?: MessageStatus;
}): React.ReactElement {
  if (group) {
    return (
      <TerminalChatResponseToolBatch
        group={group}
        fullStdout={fullStdout}
        toolCallMap={toolCallMap}
        theme={theme}
        isActive={isActive}
      />
    );
  }

  if (!item) {
    return <></>;
  }

  // Suppress role if:
  // 1. Explicitly disabled (showRole=false)
  // 2. Previous role is the same as current role
  // 3. Previous role was 'tool' and current is 'assistant' (merges tool output with assistant text)
  const currentShowRole =
    showRole &&
    previousRole !== item.role &&
    !(previousRole === "tool" && item.role === "assistant");

  switch (item.role) {
    case "user":
      return (
        <TerminalChatResponseMessage
          message={item}
          theme={theme}
          showRole={currentShowRole}
          isActive={isActive}
        />
      );
    case "assistant":
      return (
        <>
          <TerminalChatResponseMessage
            message={item}
            theme={theme}
            model={model}
            showRole={currentShowRole}
            disableMarkdown={isStreaming}
            isActive={isActive}
          />
          {item.tool_calls?.map((toolCall, i) => {
            return (
              <TerminalChatResponseToolCall
                key={i}
                message={toolCall}
                loading={loading}
                theme={theme}
                status={(toolCall as any).status}
              />
            );
          })}
        </>
      );
    case "tool":
      return (
        <TerminalChatResponseMessage
          message={item}
          fullStdout={fullStdout}
          toolCallMap={toolCallMap}
          theme={theme}
          model={model}
          showRole={false}
          isActive={isActive}
          status={status}
        />
      );
    default:
      break;
  }
  // Fallback for any other message type
  return <TerminalChatResponseGenericMessage message={item} />;
}

export default React.memo(TerminalChatResponseItem);

export function TerminalChatResponseGenericMessage({
  message,
}: {
  message: ChatCompletionMessageParam;
}): React.ReactElement {
  // For generic messages, we'll just stringify and show the content
  return <Text>{JSON.stringify(message, null, 2)}</Text>;
}
