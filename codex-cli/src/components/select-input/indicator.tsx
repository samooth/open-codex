import figures from "figures";
import { Box, Text } from "ink";
import React from "react";
import type { Theme } from "../../utils/theme.js";

export type Props = {
  readonly isSelected?: boolean;
  readonly theme: Theme;
};

function Indicator({ isSelected = false, theme }: Props): React.ReactElement {
  return (
    <Box marginRight={1}>
      {isSelected ? (
        <Text color={theme.highlight}>{figures.pointer}</Text>
      ) : (
        <Text> </Text>
      )}
    </Box>
  );
}

export default Indicator;
