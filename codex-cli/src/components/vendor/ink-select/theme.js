const theme = {
  styles: {
    container: () => ({
      flexDirection: "column",
    }),
    option: ({ isFocused }) => ({
      gap: 1,
      paddingLeft: isFocused ? 0 : 2,
    }),
    selectedIndicator: () => ({
      color: "greenBright",
    }),
    focusIndicator: () => ({
      color: "cyanBright",
    }),
    label({ isFocused, isSelected }) {
      let color = "white";
      if (isSelected) {
        color = "greenBright";
      }
      if (isFocused) {
        color = "cyanBright";
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
