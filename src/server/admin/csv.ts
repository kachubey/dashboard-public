// Spreadsheet apps execute cells that start with = + - @ (CSV/formula
// injection) — e.g. a user agent or file name crafted by someone. Such cells
// are prefixed with an apostrophe so they stay plain text.
export function csvCell(value: unknown): string {
  let s =
    value === null || value === undefined
      ? ""
      : value instanceof Date
        ? value.toISOString()
        : typeof value === "object"
          ? JSON.stringify(value)
          : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
