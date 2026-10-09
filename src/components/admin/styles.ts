// Native <select>/<input type=date> in filter forms: plain GET forms work
// without JavaScript and keep filters in the URL (shareable, back button).
export const selectClass =
  "h-8 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30 [&>option]:bg-popover";
export const dateClass = selectClass;
