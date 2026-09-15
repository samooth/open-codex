import type { AgentLoop } from "../../utils/agent/agent-loop.js";
import type { Theme } from "../../utils/theme.js";

import { TerminalHyperlink, getFileUrl } from "./terminal-hyperlink.js";
import { useTerminalSize } from "../../hooks/use-terminal-size.js";
import { truncateEnd, truncateMiddle } from "../../utils/short-path.js";
import { Box, Text } from "ink";
import React from "react";

export interface TerminalHeaderProps {
  version: string;
  PWD: string;
  model: string;
  approvalPolicy: string;
  colorsByPolicy: Record<string, string | undefined>;
  agent?: AgentLoop;
  initialImagePaths?: Array<string>;
  theme: Theme;
  breadcrumb?: string;
}

const TerminalHeader: React.FC<TerminalHeaderProps> = ({
  version,
  PWD,
  model,
  approvalPolicy,
  colorsByPolicy,
  theme,
  breadcrumb,
}) => {
  const { columns: terminalCols } = useTerminalSize();

  const valueStyle = { color: theme.highlight };
  const separator = <Text color={theme.divider}> · </Text>;

  // Keep the header on one line even on narrow terminals / long values.
  const maxModelLen = Math.max(16, Math.floor(terminalCols / 4));
  const displayModel = truncateEnd(model, maxModelLen);
  const displayBreadcrumb = truncateMiddle(breadcrumb ?? "", 48);

  return (
    <Box
      width={terminalCols}
      paddingX={1}
      borderStyle="single"
      borderTop={false}
      borderLeft={false}
      borderRight={false}
      borderBottomColor={theme.divider}
      marginBottom={1}
      flexDirection="column"
    >
      <Box flexDirection="row">
        <Box flexGrow={1}>
          <Text color={theme.dim}>open-codex </Text>
          <Text color={theme.dim}>v{version}</Text>
          {separator}
          <TerminalHyperlink
            url={getFileUrl(process.cwd())}
            color={valueStyle.color}
          >
            <Text color={theme.highlight}>{PWD}</Text>
          </TerminalHyperlink>
        </Box>
        <Box>
          <Text color={theme.dim}>{displayModel}</Text>
          {separator}
          <Text color={colorsByPolicy[approvalPolicy] || theme.success}>
            {approvalPolicy}
          </Text>
        </Box>
      </Box>
      {breadcrumb && (
        <Box marginTop={0}>
          <Text color={theme.dim}>└ </Text>
          <TerminalHyperlink
            url={getFileUrl(breadcrumb)}
            color={theme.highlight}
          >
            <Text color={theme.highlight} italic>
              {displayBreadcrumb}
            </Text>
          </TerminalHyperlink>
        </Box>
      )}
    </Box>
  );
};

export default TerminalHeader;
