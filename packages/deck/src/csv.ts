/**
 * A small RFC 4180 CSV reader for the deck spreadsheets.
 *
 * Hand-written rather than a dependency because the job is narrow: the three
 * files `deck:import` reads are saved from Excel or Sheets, so it needs quoted
 * fields (commas, doubled quotes and line breaks inside quotes), a UTF-8 BOM
 * and CRLF line endings, and nothing else. No type inference — every cell
 * comes back as a trimmed string, and the importer decides what it means.
 */

export interface CsvRow {
  /**
   * The row number as a spreadsheet shows it: the header is row 1, the first
   * data row is row 2. A line break inside a quoted cell does not start a new
   * row, so this matches what the owner sees in Excel rather than the line
   * number in a text editor.
   */
  readonly row: number;
  /** Cells by header name, trimmed. A row shorter than the header is padded with blanks. */
  readonly cells: Readonly<Record<string, string>>;
  /**
   * Non-blank cells beyond the last header column. Almost always an unquoted
   * comma that has shifted everything after it one column right.
   */
  readonly overflow: readonly string[];
}

export interface CsvTable {
  readonly header: readonly string[];
  readonly rows: readonly CsvRow[];
}

export class CsvError extends Error {}

/** Splits CSV text into records of raw (untrimmed) cells. */
function records(text: string): string[][] {
  const out: string[][] = [];
  let record: string[] = [];
  let cell = "";
  let quoted = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else {
        cell += ch;
      }
      i += 1;
      continue;
    }

    if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      record.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      record.push(cell);
      out.push(record);
      record = [];
      cell = "";
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
    } else {
      cell += ch;
    }
    i += 1;
  }

  if (quoted) throw new CsvError(`unclosed quote in row ${out.length + 1}`);
  // A final line with no trailing newline.
  if (cell !== "" || record.length > 0) {
    record.push(cell);
    out.push(record);
  }
  return out;
}

/**
 * Parses CSV text with a header row. Every cell is trimmed, and a cell of only
 * whitespace comes back blank. Wholly blank rows — which Excel leaves behind
 * after deleting data — are dropped, but still counted, so later row numbers
 * stay right.
 */
export function parseCsv(input: string): CsvTable {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const all = records(text);
  const headerRecord = all[0];
  if (headerRecord === undefined) throw new CsvError("the file is empty — it needs a header row");

  const header = headerRecord.map((h) => h.trim());
  const seen = new Set<string>();
  for (const name of header) {
    if (name === "") throw new CsvError("the header row has a blank column name");
    if (seen.has(name)) throw new CsvError(`the header row names "${name}" twice`);
    seen.add(name);
  }

  const rows: CsvRow[] = [];
  for (const [index, record] of all.slice(1).entries()) {
    const trimmed = record.map((c) => c.trim());
    if (trimmed.every((c) => c === "")) continue;
    const cells: Record<string, string> = {};
    for (const [col, name] of header.entries()) cells[name] = trimmed[col] ?? "";
    const overflow = trimmed.slice(header.length).filter((c) => c !== "");
    rows.push({ row: index + 2, cells, overflow });
  }
  return { header, rows };
}
