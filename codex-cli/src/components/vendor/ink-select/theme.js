const theme = {
  styles: {
    container: () => ({
      flexDirection: "column",
    }),
    option: ({ isFocused }) => ({
      gap: 1,
      paddingLeft: isFocused ? 0 : 2,
    }),
    selectedIndicator: ({ theme }) => ({
      color: theme?.success || "greenBright",
    }),
    focusIndicator: ({ theme }) => ({
      color: theme?.highlight || "cyanBright",
    }),
    label({ isFocused, isSelected, theme }) {
      let color = "white";
      if (isSelected) {
        color = theme?.success || "greenBright";
      }
      if (isFocused) {
        color = theme?.highlight || "cyanBright";
      }
      return { color };
    },
    highlightedText: () => ({
      bold: true,
    }),
  },
};
export const styles = theme.styles;
export default theme;
