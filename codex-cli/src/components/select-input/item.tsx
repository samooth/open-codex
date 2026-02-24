import { Text } from "ink";
import * as React from "react";
import type { Theme } from "../../utils/theme.js";

export type Props = {
  readonly isSelected?: boolean;
  readonly label: string;
  readonly theme: Theme;
};

function Item({ isSelected = false, label, theme }: Props): React.ReactElement {
  return <Text color={isSelected ? theme.highlight : undefined}>{label}</Text>;
}

export default Item;
