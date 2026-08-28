import type { Theme } from "../../utils/theme.js";
import { Box, Text } from "ink";
import React from "react";

/**
 * Catches render-time errors (e.g. Ink's "Text string must be rendered inside
 * <Text>" crash) and shows the offending component stack instead of terminating
 * the whole TUI. This makes otherwise cryptic crashes self-diagnosing: the stack
 * points directly at the component that emitted a bare scalar child.
 */
export class ChatErrorBoundary extends React.Component<
  {
    children: React.ReactNode;
    theme?: Theme;
    onError?: (error: Error, info: React.ErrorInfo) => void;
  },
  { error: Error | null; componentStack: string | null }
> {
  constructor(props: {
    children: React.ReactNode;
    theme?: Theme;
    onError?: (error: Error, info: React.ErrorInfo) => void;
  }) {
    super(props);
    this.state = { error: null, componentStack: null };
  }

  static getDerivedStateFromError(error: Error): {
    error: Error;
    componentStack: string | null;
  } {
    const match = /(?:in|within) '?([\w.]+)'?/.exec(error.message);
    return { error, componentStack: match ? match[1]! : null };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    this.props.onError?.(error, info);
  }

  override render(): React.ReactNode {
    if (this.state.error) {
      return (
        <Box
          flexDirection="column"
          padding={1}
          borderStyle="single"
          borderColor="red"
        >
          <Text color="red" bold>
            Render error: {this.state.error.message}
          </Text>
          {this.state.componentStack && (
            <Text color="red">
              Offending component: {this.state.componentStack}
            </Text>
          )}
          <Text color="gray">
            (component stack written to debug log; rerun with DEBUG=1 / --enable-source-maps)
          </Text>
        </Box>
      );
    }
    return this.props.children;
  }
}
