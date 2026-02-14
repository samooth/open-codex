import type { TerminalRendererOptions } from "marked-terminal";
import type {
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
} from "openai/resources/chat/completions.mjs";
import type { ResponseReasoningItem } from "openai/resources/responses/responses";

import { useTerminalSize } from "../../hooks/use-terminal-size";
import {
  parseToolCallOutput,
} from "../../utils/parsers";
import {
  getToolDisplayInfo,
  getSyntaxHighlightTheme,
} from "./terminal-chat-utils.js";
import chalk, { type ForegroundColorName } from "chalk";
import { Box, Text, useInput } from "ink";
import { marked } from "marked";
import TerminalRenderer from "marked-terminal";
import Spinner from "../vendor/ink-spinner.js";
import { highlight as syntaxHighlight } from "cli-highlight";
import React, { useMemo, useState } from "react";
import type { GroupedResponseItem } from "./use-message-grouping.js";
import type { Theme } from "../../utils/theme.js";
import { TOOL_APPLY_PATCH, TOOL_SHELL } from "../../utils/agent/tool-constants.js";


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
}: {
  item?: ChatCompletionMessageParam;
  group?: GroupedResponseItem;
  fullStdout?: boolean;
  toolCallMap?: Map<string, any>;
  loading?: boolean;
  theme: Theme;
  model: string;
  showRole?: boolean;
  previousRole?: string;
  isStreaming?: boolean;
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

  // Suppress role if:
  // 1. Explicitly disabled (showRole=false)
  // 2. Previous role is the same as current role
  // 3. Previous role was 'tool' and current is 'assistant' (merges tool output with assistant text)
  const currentShowRole = showRole && (previousRole !== item.role) && !(previousRole === "tool" && item.role === "assistant");

  switch (item.role) {
    case "user":
      return <TerminalChatResponseMessage message={item} theme={theme} showRole={currentShowRole} />;
    case "assistant":
      return (
        <>
          <TerminalChatResponseMessage 
            message={item} 
            theme={theme} 
            model={model}
            showRole={currentShowRole} 
            disableMarkdown={isStreaming} 
          />
          {!isStreaming && item.tool_calls?.map((toolCall, i) => {
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
          model={model}
          showRole={false}
        />
      );
    default:
      break;
  }
  // Fallback for any other message type
  return <TerminalChatResponseGenericMessage message={item} />;
}

export default React.memo(TerminalChatResponseItem);

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
        <Text bold color={theme.thought}>
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

export const TerminalChatResponseMessage = React.memo(function TerminalChatResponseMessage({
  message,
  fullStdout,
  toolCallMap = new Map(),
  theme,
  model,
  showRole = true,
  disableMarkdown = false,
}: {
  message: ChatCompletionMessageParam;
  fullStdout?: boolean;
  toolCallMap?: Map<string, any>;
  theme: Theme;
  model?: string;
  showRole?: boolean;
  disableMarkdown?: boolean;
}) {
  const contentParts: Array<string> = [];

  // Capture reasoning content if present (common in models like o1, o3-mini)
  if ((message as any).reasoning_content) {
    contentParts.push(`<thought>${(message as any).reasoning_content}</thought>`);
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
  
  let remainingContent = content;
  let displayContent = "";

  while (remainingContent.length > 0) {
    const thoughtMatch = remainingContent.match(/<(thought|think)>([\s\S]*?)(?:<\/(?:thought|think)>|$)/i);
    const planMatch = remainingContent.match(/<plan>([\s\S]*?)(?:<\/plan>|$)/i);

    if (!thoughtMatch && !planMatch) {
      displayContent += remainingContent;
      break;
    }

    // Determine which match comes first
    const thoughtIndex = thoughtMatch ? remainingContent.indexOf(thoughtMatch[0]) : Infinity;
    const planIndex = planMatch ? remainingContent.indexOf(planMatch[0]) : Infinity;

    if (thoughtIndex < planIndex) {
      // Add text before the match to display content
      displayContent += remainingContent.slice(0, thoughtIndex);
      if (thoughtMatch) {
        thoughts.push((thoughtMatch[2] || "").trim());
        remainingContent = remainingContent.slice(thoughtIndex + thoughtMatch[0].length);
      } else {
        remainingContent = remainingContent.slice(thoughtIndex);
      }
    } else {
      displayContent += remainingContent.slice(0, planIndex);
      if (planMatch) {
        plans.push((planMatch[1] || "").trim());
        remainingContent = remainingContent.slice(planIndex + planMatch[0].length);
      } else {
        remainingContent = remainingContent.slice(planIndex);
      }
    }
  }

  const hasThoughts = thoughts.length > 0;
  const hasPlans = plans.length > 0;
  const hasContent = displayContent.trim().length > 0;

  const roleColor = message.role === "assistant" ? theme.assistant : "yellowBright";
  const isAssistant = message.role === "assistant";

  if (!isAssistant && hasContent) {
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Text color="yellowBright">
          <Text bold>👤 user </Text>
          <Text dimColor>› </Text>
          {displayContent.trim()}
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingLeft={isAssistant ? 2 : 0}>
      {showRole && (hasContent || (!hasThoughts && !hasPlans)) && (
        <Box gap={1}>
          <Text bold color={roleColor}>
            {isAssistant ? "🤖 opencodex" : "👤 user"}
          </Text>
          {isAssistant && model && (
            <Text dimColor italic>
              ({model})
            </Text>
          )}
        </Box>
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
        <Box flexDirection="column">
          {isAssistant ? (
            <Markdown theme={theme}>
              {displayContent.trim()}
            </Markdown>
          ) : (
            <Text color="yellowBright">{displayContent.trim()}</Text>
          )}
          {disableMarkdown && (
            <Text> <Spinner type="dots" color={theme.highlight} /></Text>
          )}
        </Box>
      )}
    </Box>
  );
});

const TerminalChatResponseToolCall = React.memo(function TerminalChatResponseToolCall({
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
    <Box
      flexDirection="column"
      gap={0}
      marginY={1}
      borderStyle="round"
      borderColor={theme.highlight}
      width="100%"
    >
      <Box paddingX={1}>
        {loading ? (
          <Box marginRight={1}>
            <Spinner type="dots" color={theme.toolLabel} />
          </Box>
        ) : (
          <Text color={theme.toolIcon} bold>
            {icon}
          </Text>
        )}
        <Box marginRight={1}>
          <Text color={theme.toolLabel} bold>
            {label}
          </Text>
        </Box>
        <Box flexShrink={1}>
          <Text color={theme.dim} wrap="wrap">{summary}</Text>
        </Box>
      </Box>
      {(loading || details?.cmdReadableText) && (toolName === TOOL_SHELL ||
        toolName === TOOL_APPLY_PATCH) && (
        <Box paddingLeft={2} marginTop={details?.cmdReadableText ? 1 : 0}>
          <Text color={theme.dim}>$ {details?.cmdReadableText}</Text>
        </Box>
      )}
    </Box>
  );
});

const TerminalChatResponseToolCallOutput = React.memo(function TerminalChatResponseToolCallOutput({
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
  const { exit_code, duration_seconds, type, url, query } =
    metadata as any;

  const [isCollapsed, setIsCollapsed] = useState(() => {
    if (fullStdout) return false;
    const lines = output.trim().split("\n");
    return lines.length > 10;
  });

  useInput((input) => {
    if (input === "c") {
      setIsCollapsed(!isCollapsed);
    }
  });

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
      ]
        .filter(Boolean)
        .join(", "),
    [exit_code, duration_seconds],
  );

  let label = "stdout";
  let labelColor: ForegroundColorName = theme.dim as ForegroundColorName;
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

  let displayedContent = output.trim();
  const lineCount = displayedContent.split("\n").length;
  const isLargeOutput = lineCount > 10 || displayedContent.length > 9000;

  if (isCollapsed) {
    const lines = displayedContent.split("\n");
    if (lines.length > 10) {
      const head = lines.slice(0, 10);
      const remaining = lines.length - 10;
      displayedContent = [...head, chalk.gray(`... (${remaining} more lines, press 'c' to expand)`)].join("\n");
    }
    // Truncate very long outputs
    if (displayedContent.length > 9000) {
      displayedContent =
        displayedContent.slice(0, 9000) +
        chalk.gray(`\n... (truncated, ${output.length - 9000} more characters, press 'c' to expand)`);
    }
  }

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
        const args = JSON.parse((toolCall as any)?.function?.arguments || "{}");
        const filePath = args.path || "";
        const extension = filePath.split(".").pop()?.toLowerCase();
        if (extension) language = extension;
      } catch { /* ignore */ }
    }

    if (language) {
      try {
        const highlighted = syntaxHighlight(displayedContent, { 
          language, 
          ignoreIllegals: true,
          theme: getSyntaxHighlightTheme(theme)
        });
        return highlighted.split("\n");
      } catch { /* ignore */ }
    }

    return displayedContent
      .split("\n")
      .map((line) => {
        if (line.startsWith("+") && !line.startsWith("++")) return chalk.bgGreen.white(line.padEnd(line.length + 1));
        if (line.startsWith("-") && !line.startsWith("--")) {
          const bgMethod = `bg${theme.deletion.charAt(0).toUpperCase()}${theme.deletion.slice(1)}` as any;
          return (chalk as any)[bgMethod] ? (chalk as any)[bgMethod].white(line.padEnd(line.length + 1)) : chalk.bgMagenta.white(line.padEnd(line.length + 1));
        }
        return line;
      });
  }, [
    displayedContent,
    toolName,
    JSON.stringify(toolCall),
  ]);

  return (
    <Box
      flexDirection="column"
      gap={0}
      borderStyle="round"
      borderColor={isError ? theme.error : theme.highlight}
      marginY={0}
      width="100%"
    >
      {toolCall && (
        <Box paddingX={1} marginBottom={isDebug || isError ? 1 : 0}>
          <Box marginRight={1}>
            <Text color={theme.toolIcon} bold>
              {icon}
            </Text>
          </Box>
          <Box marginRight={1}>
            <Text color={theme.toolLabel} bold>
              {callLabel}
            </Text>
          </Box>
          <Box flexShrink={1}>
            <Text color={theme.dim} wrap="wrap">{summary}</Text>
          </Box>
        </Box>
      )}

      {(isError || isDebug) && toolCall && (toolCall as any).function && (
        <Box flexDirection="column" paddingLeft={3} paddingRight={1} marginBottom={1}>
          <Box gap={1}>
            <Text bold color={theme.dim}>args:</Text>
            <Text color={theme.dim} wrap="wrap">{(toolCall as any).function.arguments}</Text>
          </Box>
        </Box>
      )}

      <Box gap={1} paddingX={1}>
        <Text color={labelColor} bold wrap="wrap">
          {label}
        </Text>
        <Text color={theme.dim} wrap="wrap">{metadataInfo ? `(${metadataInfo})` : ""}</Text>
      </Box>
      {headerContent && (
        <Box paddingX={1}>
          <Text italic color={theme.highlight} wrap="wrap">
            {headerContent}
          </Text>
        </Box>
      )}
      <Box marginTop={displayedContent ? 0 : 0} paddingX={1} flexDirection="column">
        {Array.isArray(colorizedContent) ? (
          colorizedContent.map((line, i) => (
            <Box key={i}>
              <Text color="gray">{(i + 1).toString().padStart(3)} </Text>
              <Box flexShrink={1}>
                <Text wrap="wrap" color={type !== "web_fetch" && type !== "web_search" ? theme.dim : undefined}>{line}</Text>
              </Box>
            </Box>
          ))
        ) : (
          <Text color={type !== "web_fetch" && type !== "web_search" ? theme.dim : undefined} wrap="wrap">
            {colorizedContent || chalk.italic.gray("(no output)")}
          </Text>
        )}
      </Box>
      {!isCollapsed && isLargeOutput && (
        <Box marginTop={0} paddingX={1}>
          <Text color={theme.dim} italic>(press 'c' to collapse)</Text>
        </Box>
      )}
    </Box>
  );
});
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
    <Box flexDirection="column" gap={0} marginY={0}>
      <Box gap={1} marginBottom={0} marginLeft={2}>
        <Text color={theme.dim} bold italic>
          batch: {items.length} ops
        </Text>
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
            const { metadata } = parseToolCallOutput((item as any).content as string);
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
              theme: getSyntaxHighlightTheme(theme)
            });
          } catch {
            return code;
          }
        },
        // Enhanced styling
        heading: (text: string) => chalk[theme.assistant as ForegroundColorName]?.bold(text) || chalk.bold(text),
        firstHeading: (text: string) => chalk[theme.assistant as ForegroundColorName]?.bold?.underline(text) || chalk.bold.underline(text),
        strong: (text: string) => chalk.bold(text),
        em: (text: string) => chalk.italic(text),
        codespan: (text: string) => chalk.cyan(text),
        code: (text: string) => chalk.reset(text),
        tableOptions: {
          style: {
            head: [theme.highlight, "bold"],
            border: [theme.dim],
          },
        },
      } as any);

      const parsed = marked.parse(children, { 
        async: false,
        gfm: true,
        breaks: true,
        renderer: renderer as any
      });

      if (typeof parsed !== "string" || !parsed) {
        return parsed || children;
      }

      // Enhanced Task List Rendering
      const taskListFixed = parsed
        .replace(/^[ \t]*[*+-][ \t]+\[x\][ \t]+/gim, chalk[theme.success as ForegroundColorName]("✅ "))
        .replace(/^[ \t]*[*+-][ \t]+\[ \][ \t]+/gim, chalk[theme.dim as ForegroundColorName]("⬜ "))
        .replace(/(\n)[ \t]{2,}[*+-][ \t]+\[x\][ \t]+/gim, `$1  ${chalk[theme.success as ForegroundColorName]("✅ ")}`)
        .replace(/(\n)[ \t]{2,}[*+-][ \t]+\[ \][ \t]+/gim, `$1  ${chalk[theme.dim as ForegroundColorName]("⬜ ")}`);

      return taskListFixed;
    } catch (e) {
      return children;
    }
  }, [children, size.columns, theme]);

  return (
    <Box flexDirection="column" width="100%">
      <Text>{renderedParts}</Text>
    </Box>
  );
}
