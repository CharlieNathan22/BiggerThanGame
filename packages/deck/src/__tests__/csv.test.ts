import { describe, expect, it } from "vitest";
import { CsvError, parseCsv } from "../csv.js";

/** What Excel puts at the start of a "CSV UTF-8" file. */
const BOM = String.fromCharCode(0xfeff);

describe("parseCsv", () => {
  it("reads a header and rows into trimmed cells", () => {
    const t = parseCsv("a,b\n 1 , two \n");
    expect(t.header).toEqual(["a", "b"]);
    expect(t.rows).toEqual([{ row: 2, cells: { a: "1", b: "two" }, overflow: [] }]);
  });

  it("strips an Excel BOM and reads CRLF line endings", () => {
    const t = parseCsv(BOM + "player_id,name\r\npele,Pelé\r\nmuller-gerd,Gerd Müller\r\n");
    expect(t.header).toEqual(["player_id", "name"]);
    expect(t.rows.map((r) => r.cells)).toEqual([
      { player_id: "pele", name: "Pelé" },
      { player_id: "muller-gerd", name: "Gerd Müller" },
    ]);
  });

  it("reads quoted fields with commas, doubled quotes and line breaks", () => {
    const t = parseCsv('a,b\n"x, y","say ""hi"""\n"line\none",z\nlast,row');
    expect(t.rows.map((r) => r.cells)).toEqual([
      { a: "x, y", b: 'say "hi"' },
      { a: "line\none", b: "z" },
      { a: "last", b: "row" },
    ]);
    // A line break inside quotes doesn't start a spreadsheet row.
    expect(t.rows.map((r) => r.row)).toEqual([2, 3, 4]);
  });

  it("treats a cell of only whitespace as blank and pads short rows", () => {
    const t = parseCsv("a,b,c\n1,   \n");
    expect(t.rows[0]!.cells).toEqual({ a: "1", b: "", c: "" });
  });

  it("drops wholly blank rows but keeps counting them", () => {
    const t = parseCsv("a,b\n1,2\n,\n\n3,4\n");
    expect(t.rows.map((r) => r.row)).toEqual([2, 5]);
  });

  it("reports cells past the last column", () => {
    const t = parseCsv("a,b\n1,2,3,\n");
    expect(t.rows[0]!.overflow).toEqual(["3"]);
  });

  it("refuses an unclosed quote, an empty file and a bad header", () => {
    expect(() => parseCsv('a\n"open')).toThrow(CsvError);
    expect(() => parseCsv("")).toThrow(/empty/);
    expect(() => parseCsv("a,a\n")).toThrow(/twice/);
    expect(() => parseCsv("a,,b\n")).toThrow(/blank column/);
  });
});
