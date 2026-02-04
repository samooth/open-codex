import type { TerminalRendererOptions } from "marked-terminal";
import type {
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
} from "openai/resources/chat/completions.mjs";
import type { ResponseReasoningItem } from "openai/resources/responses/responses";

import { useTerminalSize } from "../../hooks/use-terminal-size";
import {
  parseToolCallChatCompletion,
  parseToolCallOutput,
} from "../../utils/parsers";
import chalk, { type ForegroundColorName } from "chalk";
import { Box, Text } from "ink";
import { parse, setOptions } from "marked";
import TerminalRenderer from "marked-terminal";
import Spinner from "../vendor/ink-spinner.js";
import { highlight } from "cli-highlight";
import React, { useMemo } from "react";
import type { GroupedResponseItem } from "./use-message-grouping.js";
import type { Theme } from "../../utils/theme.js";

export default function TerminalChatResponseItem({
  item,
  group,
  fullStdout = false,
  toolCallMap = new Map(),
  loading = false,
  theme,
}: {
  item?: ChatCompletionMessageParam;
  group?: GroupedResponseItem;
  fullStdout?: boolean;
  toolCallMap?: Map<string, any>;
  loading?: boolean;
  theme: Theme;
}): React.ReactElement {
  if (group) {
    return (
      <TerminalChatResponseToolBatch
        group={group}
        fullStdout={fullStdout}
        toolCallMap={toolCallMap}
        theme={theme}
      />
    );
  }

  if (!item) return <></>;

  switch (item.role) {
    case "user":
      return <TerminalChatResponseMessage message={item} theme={theme} />;
    case "assistant":
      return (
        <>
          <TerminalChatResponseMessage message={item} theme={theme} />
          {item.tool_calls?.map((toolCall, i) => {
            return (
              <TerminalChatResponseToolCall
                key={i}
                message={toolCall}
                loading={loading}
                theme={theme}
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
        />
      );
    default:
      break;
  }
  // Fallback for any other message type
  return <TerminalChatResponseGenericMessage message={item} />;
}

// TODO: this should be part of `ResponseReasoningItem`. Also it doesn't work.
// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

/**
 * Guess how long the assistant spent "thinking" based on the combined length
 * of the reasoning summary. The calculation itself is fast, but wrapping it in
 * `useMemo` in the consuming component ensures it only runs when the
 * `summary` array actually changes.
 */
// TODO: use actual thinking time
//
// function guessThinkingTime(summary: Array<ResponseReasoningItem.Summary>) {
//   const totalTextLength = summary
//     .map((t) => t.text.length)
//     .reduce((a, b) => a + b, summary.length - 1);
//   return Math.max(1, Math.ceil(totalTextLength / 300));
// }

export function TerminalChatResponseReasoning({
  message,
}: {
  message: ResponseReasoningItem & { duration_ms?: number };
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
            <Markdown>{s.text}</Markdown>
          </Box>
        );
      })}
    </Box>
  );
}

const colorsByRole: Record<string, ForegroundColorName> = {
  assistant: "magentaBright",
  user: "blueBright",
};

function TerminalChatResponseMessage({
  message,
  fullStdout,
  toolCallMap = new Map(),
  theme,
}: {
  message: ChatCompletionMessageParam;
  fullStdout?: boolean;
  toolCallMap?: Map<string, any>;
  theme: Theme;
}) {
  const contentParts: Array<string> = [];
  // ... (content extraction stays same)
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
        contentParts.push(`<Image />`);
      }
      if (part.type === "file") {
        contentParts.push(`<File />`);
      }
    }
  }
  const content = contentParts.join("");
  if (content.length === 0) {
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
      />
    );
  }

  // Extract <thought>, <think>, or <plan> blocks (handles unclosed tags during streaming)
  const thoughts: Array<string> = [];
  const plans: Array<string> = [];
  
  const thoughtRegex = /<(thought|think)>([\s\S]*?)(?:<\/\1>|$)/gim;
  const planRegex = /<plan>([\s\S]*?)(?:<\/plan>|$)/gim;

  let displayContent = content.replace(thoughtRegex, (_, _tagName, thought) => {
    thoughts.push(thought.trim());
    return "";
  });
  
  displayContent = displayContent.replace(planRegex, (_, plan) => {
    plans.push(plan.trim());
    return "";
  });

  const hasThoughts = thoughts.length > 0;
  const hasPlans = plans.length > 0;
  const hasContent = displayContent.trim().length > 0;

  const roleColor = message.role === "assistant" ? theme.assistant : theme.user;

  return (
    <Box flexDirection="column">
      {(hasContent || (!hasThoughts && !hasPlans)) && (
        <Text bold color={roleColor}>
          {message.role === "assistant" ? "opencodex" : message.role}
        </Text>
      )}
      {thoughts.map((thought, i) => (
        <Box
          key={i}
          flexDirection="column"
          paddingLeft={2}
          borderStyle="round"
          borderColor={theme.dim}
          marginTop={hasContent ? 1 : 0}
          marginBottom={1}
        >
          <Text italic color={theme.thought}>
            thought
          </Text>
          <Text italic color={theme.dim}>{thought}</Text>
        </Box>
      ))}
      {plans.map((plan, i) => (
        <Box
          key={i}
          flexDirection="column"
          paddingLeft={2}
          borderStyle="round"
          borderColor={theme.plan}
          marginTop={1}
          marginBottom={1}
        >
          <Text bold color={theme.plan}>
            📋 plan
          </Text>
          <Markdown theme={theme}>{plan}</Markdown>
        </Box>
      ))}
      {hasContent && (
        <Markdown theme={theme}>{displayContent.trim()}</Markdown>
      )}
    </Box>
  );
}

function getToolDisplayInfo(message: ChatCompletionMessageToolCall) {
  const details = parseToolCallChatCompletion(message);
  const toolName = message.function?.name || "";
  const rawArgs = message.function?.arguments || "{}";

  let args: any = {};
  try {
    args = JSON.parse(rawArgs);
  } catch {
    // ignore
  }

  let label = "command";
  let icon = "⚙️";
  let color: ForegroundColorName = "magentaBright";
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
  } else if (toolName.includes("apply_patch")) {
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
  } else if (toolName === "shell" || toolName === "repo_browser.exec") {
    label = "shell";
    icon = "🐚";
    summary = details?.cmdReadableText;
  }

  return { label, icon, color, summary, toolName, details };
}

function TerminalChatResponseToolCall({
  message,
  loading = false,
  theme,
}: {
  message: ChatCompletionMessageToolCall;
  loading?: boolean;
  theme: Theme;
}) {
  const { label, icon, summary, toolName, details } =
    getToolDisplayInfo(message);

  return (
    <Box flexDirection="column" gap={0} marginY={0} paddingX={1} paddingLeft={2}>
      <Box gap={1}>
        {loading ? (
          <Spinner type="dots" color={theme.toolLabel} />
        ) : (
          <Text color={theme.toolIcon} bold>
            {icon}
          </Text>
        )}
        <Text color={theme.toolLabel} bold>
          {label}
        </Text>
        <Text color={theme.dim}>{summary}</Text>
      </Box>
      {(toolName === "shell" ||
        toolName === "repo_browser.exec" ||
        toolName === "apply_patch") && (
        <Box paddingLeft={2}>
          <Text color={theme.dim}>$ {details?.cmdReadableText}</Text>
        </Box>
      )}
    </Box>
  );
}

function TerminalChatResponseToolCallOutput({
  content,
  fullStdout,
  toolCall,
  theme,
}: {
  content: string;
  fullStdout: boolean;
  toolCall?: ChatCompletionMessageToolCall;
  theme: Theme;
}) {
  const { output, metadata } = parseToolCallOutput(content);
  const { exit_code, duration_seconds, working_directory, type, url, query } =
    metadata as any;
  const isDebug =
    process.env["DEBUG"] === "1" || process.env["NODE_ENV"] === "development";
  const isError = exit_code !== 0 && typeof exit_code !== "undefined";

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
        working_directory ? `pwd: ${working_directory}` : "",
      ]
        .filter(Boolean)
        .join(", "),
    [exit_code, duration_seconds, working_directory],
  );

  let label = "command.stdout";
  let labelColor: ForegroundColorName = theme.toolLabel;
  let headerContent: string | undefined;

  if (type === "web_fetch") {
    label = "web.fetch";
    labelColor = theme.highlight;
    headerContent = url;
  } else if (type === "web_search") {
    label = "web.search";
    labelColor = theme.highlight;
    headerContent = `query: ${query}`;
  }

  let displayedContent = output;
  if (!fullStdout) {
    const lines = displayedContent.split("\n");
    if (lines.length > 4) {
      const head = lines.slice(0, 4);
      const remaining = lines.length - 4;
      displayedContent = [...head, `... (${remaining} more lines)`].join("\n");
    }
  }

  // -------------------------------------------------------------------------
  // Syntax Highlighting
  // -------------------------------------------------------------------------
  const colorizedContent = useMemo(() => {
    let language: string | undefined;

    if (toolName === "search_codebase" || toolName === "semantic_search") {
      language = "json";
    } else if (
      toolName === "read_file" ||
      toolName === "read_file_lines" ||
      toolName === "write_file"
    ) {
      try {
        const args = JSON.parse(toolCall?.function.arguments || "{}");
        const filePath = args.path || "";
        const extension = filePath.split(".").pop()?.toLowerCase();
        if (extension) {
          // Map common extensions to highlight.js names if needed, 
          // but cli-highlight/highlight.js usually handles them well.
          language = extension;
        }
      } catch {
        /* ignore */
      }
    }

    if (language) {
      try {
        return highlight(displayedContent, {
          language,
          ignoreIllegals: true,
        });
      } catch {
        /* fallback to regular colorization */
      }
    }

    // -------------------------------------------------------------------------
    // Fallback: Colorize diff output: lines starting with '-' in red, '+' in green.
    // -------------------------------------------------------------------------
    return displayedContent
      .split("\n")
      .map((line) => {
        if (line.startsWith("+") && !line.startsWith("++")) {
          return chalk.green(line);
        }
        if (line.startsWith("-") && !line.startsWith("--")) {
          return chalk.red(line);
        }
        return line;
      })
      .join("\n");
  }, [displayedContent, toolName, toolCall]);

  return (
    <Box
      flexDirection="column"
      gap={0}
      borderStyle="round"
      borderColor={isError ? theme.error : theme.dim}
      paddingX={1}
      marginY={1}
      width="100%"
    >
      {toolCall && (
        <Box gap={1}>
          <Text color={theme.toolIcon} bold>
            {icon}
          </Text>
          <Text color={theme.toolLabel} bold>
            {callLabel}
          </Text>
          <Text color={theme.dim}>{summary}</Text>
        </Box>
      )}

      {(isError || isDebug) && toolCall && (
        <Box flexDirection="column" paddingLeft={2} marginBottom={1}>
          <Text bold color={isError ? theme.error : theme.dim}>
            {isError ? "❌ Tool Call Failed" : "🔍 Tool Call Details"}
          </Text>
          <Box gap={1}>
            <Text bold color={theme.dim}>tool:</Text>
            <Text color={theme.dim}>{toolCall.function.name}</Text>
          </Box>
          <Box gap={1}>
            <Text bold color={theme.dim}>arguments:</Text>
            <Text color={theme.dim}>{toolCall.function.arguments}</Text>
          </Box>
        </Box>
      )}

      <Box gap={1} marginTop={toolCall ? 1 : 0}>
        <Text color={labelColor} bold>
          {label}
        </Text>
        <Text color={theme.dim}>{metadataInfo ? `(${metadataInfo})` : ""}</Text>
      </Box>
      {headerContent && (
        <Box marginBottom={0}>
          <Text italic color={theme.highlight}>
            {headerContent}
          </Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text color={type !== "web_fetch" && type !== "web_search" ? theme.dim : undefined}>
          {colorizedContent}
        </Text>
      </Box>
    </Box>
  );
}

export function TerminalChatResponseGenericMessage({
  message,
}: {
  message: ChatCompletionMessageParam;
}): React.ReactElement {
  // For generic messages, we'll just stringify and show the content
  return <Text>{JSON.stringify(message, null, 2)}</Text>;
}

export type MarkdownProps = TerminalRendererOptions & {
  children: string;
};

function TerminalChatResponseToolBatch({
  group,
  toolCallMap,
  fullStdout,
  theme,
}: {
  group: GroupedResponseItem;
  toolCallMap: Map<string, any>;
  fullStdout: boolean;
  theme: Theme;
}) {
  const items = group.items;
  const isLargeBatch = items.length > 3;

  return (
    <Box flexDirection="column" gap={0} marginY={1}>
      <Box gap={1} marginBottom={1}>
        <Text bold color={theme.dim}>
          🛠️ Tool Batch
        </Text>
        <Text color={theme.dim}>({items.length} operations)</Text>
      </Box>
      <Box flexDirection="column" gap={0}>
        {items.map((item, i) => {
          // Heuristic: If it's a large batch, show a compact summary for early items
          if (isLargeBatch && i < items.length - 3) {
            const toolCallId = (item as any).tool_call_id;
            const toolCall = toolCallMap.get(toolCallId);
            const { icon, label, summary } = toolCall
              ? getToolDisplayInfo(toolCall)
              : { icon: "⚙️", label: "tool", summary: "" };
            const { metadata } = parseToolCallOutput(item.content as string);
            const isError =
              metadata.exit_code !== 0 && typeof metadata.exit_code !== "undefined";

            return (
              <Box key={i} gap={1} paddingLeft={2}>
                <Text color={isError ? theme.error : theme.dim}>{isError ? "❌" : "✅"}</Text>
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
            />
          );
        })}
      </Box>
    </Box>
  );
}

export function Markdown({
  children,
  theme,
  ...options
}: MarkdownProps & { theme: Theme }): React.ReactElement {
  const size = useTerminalSize();

  const rendered = React.useMemo(() => {
    // Configure marked for this specific render
    setOptions({
      gfm: true,
      breaks: true,
      // @ts-expect-error missing parser, space props
      renderer: new TerminalRenderer({
        ...options,
        width: size.columns,
        tab: 2,
        highlight: (code: string, lang: string) => {
          return highlight(code, { language: lang, ignoreIllegals: true });
        },
        // Enhanced styling
        heading: chalk[theme.assistant as ForegroundColorName].bold,
        firstHeading: chalk[theme.assistant as ForegroundColorName].bold.underline,
        tableOptions: {
          style: {
            head: [theme.highlight, "bold"],
            border: [theme.dim],
          },
          chars: {
            top: "─",
            "top-mid": "┬",
            "top-left": "┌",
            "top-right": "┐",
            bottom: "─",
            "bottom-mid": "┴",
            "bottom-left": "└",
            "bottom-right": "┘",
            left: "│",
            "left-mid": "├",
            mid: "─",
            "mid-mid": "┼",
            right: "│",
            "right-mid": "┤",
            middle: "│",
          },
        },
      }),
    });
    const parsed = parse(children, { async: false }).trim();

    // Enhanced Task List Rendering (post-parse fix for reliability)
    // Matches GFM task list patterns and replaces them with icons
    const fixedOutput = parsed
      .replace(/^[ \t]*[*+-][ \t]+\[x\][ \t]+/gim, chalk[theme.success as ForegroundColorName]("✅ "))
      .replace(/^[ \t]*[*+-][ \t]+\[ \][ \t]+/gim, chalk[theme.dim as ForegroundColorName]("⬜ "))
      // Handle nested task lists (up to a few levels of indentation)
      .replace(/(\n)[ \t]{2,}[*+-][ \t]+\[x\][ \t]+/gim, `$1  ${chalk[theme.success as ForegroundColorName]("✅ ")}`)
      .replace(/(\n)[ \t]{2,}[*+-][ \t]+\[ \][ \t]+/gim, `$1  ${chalk[theme.dim as ForegroundColorName]("⬜ ")}`);

    return fixedOutput;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- options is an object of primitives
  }, [children, size.columns, size.rows, theme]);

  return <Text>{rendered}</Text>;
}
