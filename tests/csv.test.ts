import { describe, expect, it } from "vitest";
import { csvCell } from "@/server/admin/csv";

describe("CSV export cells", () => {
  it("neutralizes spreadsheet formulas", () => {
    expect(csvCell("=HYPERLINK(\"http://x\")")).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("-1")).toBe("'-1");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
  });

  it("quotes separators and serializes values", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(new Date("2026-10-08T00:00:00Z"))).toBe("2026-10-08T00:00:00.000Z");
    expect(csvCell({ a: 1 })).toBe('"{""a"":1}"');
  });
});
