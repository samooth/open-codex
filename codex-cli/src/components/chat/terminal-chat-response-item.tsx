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
import { highlight } from "cli-highlight";
import React, { useMemo } from "react";

export default function TerminalChatResponseItem({
  item,
  fullStdout = false,
  history = [],
}: {
  item: ChatCompletionMessageParam;
  fullStdout?: boolean;
  history?: Array<ChatCompletionMessageParam>;
}): React.ReactElement {
  switch (item.role) {
    case "user":
      return <TerminalChatResponseMessage message={item} />;
    case "assistant":
      return (
        <>
          <TerminalChatResponseMessage message={item} />
          {item.tool_calls?.map((toolCall, i) => {
            return <TerminalChatResponseToolCall key={i} message={toolCall} />;
          })}
        </>
      );
    case "tool":
      return (
        <TerminalChatResponseMessage
          message={item}
          fullStdout={fullStdout}
          history={history}
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
  history = [],
}: {
  message: ChatCompletionMessageParam;
  fullStdout?: boolean;
  history?: Array<ChatCompletionMessageParam>;
}) {
  const contentParts: Array<string> = [];
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
    const toolCallMessage = history.find(
      (m) =>
        m.role === "assistant" &&
        m.tool_calls?.some((tc) => tc.id === toolCallId),
    );
    const toolCall = toolCallMessage?.tool_calls?.find(
      (tc) => tc.id === toolCallId,
    );

    return (
      <TerminalChatResponseToolCallOutput
        content={content}
        fullStdout={!!fullStdout}
        toolCall={toolCall}
      />
    );
  }

  // Extract <thought> or <think> blocks
  const thoughts: Array<string> = [];
  const displayContent = content.replace(
    /<(thought|think)>([\s\S]*?)<\/\1>/g,
    (_, _tagName, thought) => {
      thoughts.push(thought.trim());
      return "";
    },
  );

  return (
    <Box flexDirection="column">
      <Text bold color={colorsByRole[message.role] || "gray"}>
        {message.role === "assistant" ? "opencodex" : message.role}
      </Text>
      {thoughts.map((thought, i) => (
        <Box
          key={i}
          flexDirection="column"
          paddingLeft={2}
          borderStyle="round"
          borderColor="gray"
          dimColor
          marginTop={1}
          marginBottom={1}
        >
          <Text italic color="cyan">
            thought
          </Text>
          <Text italic>{thought}</Text>
        </Box>
      ))}
      {displayContent.trim().length > 0 && (
        <Markdown>{displayContent.trim()}</Markdown>
      )}
    </Box>
  );
}

function TerminalChatResponseToolCall({
  message,
}: {
  message: ChatCompletionMessageToolCall;
}) {
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
  } else if (toolName.includes("list_directory") || toolName.includes("list_files")) {
    label = "listing";
    icon = "📂";
    summary = args.path || ".";
  } else if (toolName.includes("search_codebase")) {
    label = "searching";
    icon = "🔍";
    summary = `"${args.pattern || args.query}" ${args.path ? `in ${args.path}` : ""}`;
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

  return (
    <Box
      flexDirection="column"
      gap={0}
      marginY={1}
      borderStyle="round"
      borderColor="gray"
      paddingX={1}
    >
      <Box gap={1}>
        <Text color={color} bold>
          {icon} {label}
        </Text>
        <Text dimColor>{summary}</Text>
      </Box>
      {(toolName === "shell" ||
        toolName === "repo_browser.exec" ||
        toolName === "apply_patch") && (
        <Box paddingLeft={2}>
          <Text>
            <Text dimColor>$</Text> {details?.cmdReadableText}
          </Text>
        </Box>
      )}
    </Box>
  );
}

function TerminalChatResponseToolCallOutput({
  content,
  fullStdout,
  toolCall,
}: {
  content: string;
  fullStdout: boolean;
  toolCall?: ChatCompletionMessageToolCall;
}) {
  const { output, metadata } = parseToolCallOutput(content);
  const { exit_code, duration_seconds, working_directory, type, url, query } = metadata as any;
  const isDebug = process.env["DEBUG"] === "1" || process.env["NODE_ENV"] === "development";
  const isError = exit_code !== 0 && typeof exit_code !== "undefined";

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
  let labelColor: ForegroundColorName = "magenta";
  let headerContent: string | undefined;

  if (type === "web_fetch") {
    label = "web.fetch";
    labelColor = "blueBright";
    headerContent = url;
  } else if (type === "web_search") {
    label = "web.search";
    labelColor = "blueBright";
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
  // Colorize diff output: lines starting with '-' in red, '+' in green.
  // -------------------------------------------------------------------------
  const colorizedContent = displayedContent
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

  return (
    <Box
      flexDirection="column"
      gap={0}
      borderStyle="round"
      borderColor={isError ? "red" : "gray"}
      paddingX={1}
      marginY={1}
      width="100%"
    >
      {(isError || isDebug) && toolCall && (
        <Box
          flexDirection="column"
          marginBottom={1}
          borderStyle="single"
          borderColor={isError ? "red" : "gray"}
          paddingX={1}
          width="100%"
        >
          <Text bold color={isError ? "red" : "gray"}>
            {isError ? "❌ Tool Call Failed" : "🔍 Tool Call Details"}
          </Text>
          <Box gap={1}>
            <Text bold>tool:</Text>
            <Text>{toolCall.function.name}</Text>
          </Box>
          <Box gap={1} flexDirection="column">
            <Text bold>arguments:</Text>
            <Text dimColor>{toolCall.function.arguments}</Text>
          </Box>
        </Box>
      )}
      <Box gap={1}>
        <Text color={labelColor} bold>
          {label}
        </Text>
        <Text dimColor>{metadataInfo ? `(${metadataInfo})` : ""}</Text>
      </Box>
      {headerContent && (
        <Box marginBottom={0}>
          <Text italic color="cyan">
            {headerContent}
          </Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text dimColor={type !== "web_fetch" && type !== "web_search"}>
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

export function Markdown({
  children,
  ...options
}: MarkdownProps): React.ReactElement {
  const size = useTerminalSize();

  const rendered = React.useMemo(() => {
    // Configure marked for this specific render
    setOptions({
      // @ts-expect-error missing parser, space props
      renderer: new TerminalRenderer({
        ...options,
        width: size.columns,
        highlight: (code: string, lang: string) => {
          return highlight(code, { language: lang, ignoreIllegals: true });
        },
      }),
    });
    const parsed = parse(children, { async: false }).trim();

    // Remove the truncation logic
    return parsed;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- options is an object of primitives
  }, [children, size.columns, size.rows]);

  return <Text>{rendered}</Text>;
}
