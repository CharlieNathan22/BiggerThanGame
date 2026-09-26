/**
 * `deck:import`, end to end on fixture decks in temp directories. Never the
 * private submodule: the owner runs the import on the real files.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { runImport } from "../import-cli.js";
import { GENERATED_HEADER, planImport } from "../import.js";
import type { ImportPlan } from "../import.js";
import { playerSchema } from "../schema.js";

const NOW = new Date("2026-09-26T00:00:00Z");

/** What Excel puts at the start of a "CSV UTF-8" file. */
const BOM = String.fromCharCode(0xfeff);

const HEADER =
  "player_id,name,country,position,dob,deceased,iconic,club_goals,caps,apps,igoals,ct,it,clubs," +
  "ig_millions,ig_as_of,fee_eur_m,fee_year,era,main_clubs,leagues,notes";

const COLUMNS = HEADER.split(",");

/** A players.csv row from named cells; anything not named is blank. */
function row(cells: Record<string, string>): string {
  return COLUMNS.map((c) => {
    const v = cells[c] ?? "";
    return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  }).join(",");
}

const ZIDANE = {
  player_id: "zidane-zinedine",
  name: "Zinedine Zidane",
  country: "France",
  position: "MF",
  dob: "1972-06-23",
  iconic: "yes",
  club_goals: "125",
  caps: "108",
  apps: "506",
  igoals: "31",
  ct: "14",
  it: "2",
  clubs: "4",
  ig_millions: "41.2",
  ig_as_of: "2026-09-25",
  fee_eur_m: "77.5",
  fee_year: "2001",
  era: "1990s",
  main_clubs: "Bordeaux; Juventus ; Real Madrid;",
  leagues: "Ligue 1; Serie A; La Liga",
  notes: "fee disputed, check",
};

const KEEPER = {
  player_id: "buffon-gianluigi",
  name: "Gianluigi Buffon",
  country: "Italy",
  position: "GK",
  dob: "1978-01-28",
  caps: "176",
  apps: "900",
  igoals: "0",
  ct: "0",
};

// igoals is blank for a keeper; zeros elsewhere are real.
const KEEPER_OK = { ...KEEPER, igoals: "", it: "0" };

const IMAGE_HEADER = "player_id,file,width,height,author,licence,source,notes";
const zidaneImage =
  "zidane-zinedine,zidane-2008.jpg,1600,2400,Jane Smith,CC-BY-4.0,https://commons.wikimedia.org/wiki/File:Z.jpg,good";

let dir: string;
let lines: string[];

function write(name: string, text: string): void {
  writeFileSync(join(dir, name), text, "utf8");
}

function players(...rows: Record<string, string>[]): void {
  write("players.csv", [HEADER, ...rows.map(row)].join("\n") + "\n");
}

function run(...argv: string[]): number {
  lines = [];
  return runImport(argv, dir, { now: NOW, log: (l) => lines.push(l) });
}

const output = () => lines.join("\n");
const playersDir = () => join(dir, "players");
const readPlayer = (id: string) => readFileSync(join(playersDir(), `${id}.yaml`), "utf8");
const loadPlayer = (id: string) => parse(readPlayer(id)) as Record<string, unknown>;

function plan(csv: string, extra: { imageLog?: string; focus?: string } = {}): ImportPlan {
  const result = planImport({
    players: csv,
    originals: [],
    existing: new Map(),
    now: NOW,
    ...extra,
  });
  if (!result.ok) throw new Error(result.fatal.join("\n"));
  return result;
}

/** The problems reported for one skipped player, joined for matching. */
function problemsFor(p: ImportPlan, id: string): string {
  return p.skipped.find((s) => s.playerId === id)?.problems.join("\n") ?? "";
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bt-import-"));
  mkdirSync(join(dir, "originals"));
  writeFileSync(join(dir, "originals", "zidane-2008.jpg"), "");
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("the happy path", () => {
  it("writes one schema-valid file per row, in the documented shape", () => {
    players(ZIDANE, KEEPER_OK);
    write("image-log.csv", `${IMAGE_HEADER}\n${zidaneImage}\n`);
    write("focus.csv", "player_id,focus\nzidane-zinedine,50 15\n");

    expect(run()).toBe(0);
    expect(readdirSync(playersDir()).sort()).toEqual([
      "buffon-gianluigi.yaml",
      "zidane-zinedine.yaml",
    ]);

    expect(readPlayer("zidane-zinedine")).toBe(
      [
        GENERATED_HEADER,
        "id: zidane-zinedine",
        "name: Zinedine Zidane",
        "country: France",
        "position: MF",
        "dob: 1972-06-23",
        "iconic: true",
        "era: 1990s",
        "main_clubs: [Bordeaux, Juventus, Real Madrid]",
        "leagues: [Ligue 1, Serie A, La Liga]",
        "stats:",
        "  club_goals: 125",
        "  caps: 108",
        "  apps: 506",
        "  igoals: 31",
        "  ct: 14",
        "  it: 2",
        "  clubs: 4",
        "  ig: { value: 41.2, as_of: 2026-09-25 }",
        "  fee: { value: 77.5, year: 2001 }",
        "image:",
        "  file: zidane-2008.jpg",
        "  author: Jane Smith",
        "  licence: CC-BY-4.0",
        "  source: https://commons.wikimedia.org/wiki/File:Z.jpg",
        "  focus: 50 15",
        "",
      ].join("\n"),
    );

    for (const id of ["zidane-zinedine", "buffon-gianluigi"]) {
      expect(playerSchema.safeParse(loadPlayer(id)).success).toBe(true);
    }
    expect(output()).toMatch(/2 player\(s\) valid — 2 written \(2 new, 0 changed\)/);
    expect(output()).toMatch(/skipped: none/);
  });

  it("omits blank cells and keeps zeros", () => {
    players(KEEPER_OK);
    expect(run()).toBe(0);
    const p = loadPlayer("buffon-gianluigi");
    expect(p.stats).toEqual({ caps: 176, apps: 900, ct: 0, it: 0 });
    expect(p).not.toHaveProperty("deceased");
    expect(p).not.toHaveProperty("iconic");
    expect(p).not.toHaveProperty("era");
    expect(p).not.toHaveProperty("main_clubs");
    expect(p).not.toHaveProperty("image");
  });

  it("maps deceased: yes to true", () => {
    players({ ...KEEPER_OK, deceased: "yes" });
    expect(run()).toBe(0);
    expect(loadPlayer("buffon-gianluigi").deceased).toBe(true);
  });

  it("splits semicolon lists, trimming and dropping blanks", () => {
    const p = plan(
      [HEADER, row({ ...ZIDANE, main_clubs: " ; Bordeaux;;Juventus ;", leagues: ";" })].join("\n"),
    );
    const y = parse(p.files.get("zidane-zinedine")!) as Record<string, unknown>;
    expect(y.main_clubs).toEqual(["Bordeaux", "Juventus"]);
    expect(y).not.toHaveProperty("leagues");
  });

  it("rejects a list separated by commas", () => {
    const p = plan([HEADER, row({ ...ZIDANE, main_clubs: "Juventus, Real Madrid" })].join("\n"));
    expect(problemsFor(p, "zidane-zinedine")).toMatch(/main_clubs: .*semicolons, not commas/);
  });

  it("parses a BOM and CRLF file from Excel", () => {
    const csv = BOM + [HEADER, row(ZIDANE), row(KEEPER_OK)].join("\r\n") + "\r\n";
    write("players.csv", csv);
    write("image-log.csv", `${BOM}${IMAGE_HEADER}\r\n${zidaneImage}\r\n`);
    expect(run()).toBe(0);
    const p = loadPlayer("zidane-zinedine");
    expect(p.id).toBe("zidane-zinedine");
    expect(p.leagues).toEqual(["Ligue 1", "Serie A", "La Liga"]);
    expect((p.image as Record<string, unknown>).source).toBe(
      "https://commons.wikimedia.org/wiki/File:Z.jpg",
    );
    expect(readPlayer("zidane-zinedine")).not.toContain("\r");
  });
});

describe("paired stats", () => {
  it("reject ig_millions without ig_as_of, and the reverse", () => {
    const p = plan(
      [
        HEADER,
        row({ ...ZIDANE, ig_as_of: "" }),
        row({ ...KEEPER_OK, ig_as_of: "2026-09-01" }),
      ].join("\n"),
    );
    expect(problemsFor(p, "zidane-zinedine")).toMatch(
      /ig_as_of: is required when ig_millions is set/,
    );
    expect(problemsFor(p, "buffon-gianluigi")).toMatch(/ig_millions: is blank but ig_as_of/);
  });

  it("import a fee with no year as a warning, leaving the fee out", () => {
    players({ ...ZIDANE, fee_year: "" });
    expect(run()).toBe(0);
    const stats = loadPlayer("zidane-zinedine").stats as Record<string, unknown>;
    expect(stats).not.toHaveProperty("fee");
    expect(stats.caps).toBe(108);
    expect(output()).toMatch(/fee needs a year: 1 player\(s\)[^\n]*\n {2}zidane-zinedine/);
  });

  it("reject a fee year with no fee", () => {
    const p = plan([HEADER, row({ ...ZIDANE, fee_eur_m: "" })].join("\n"));
    expect(problemsFor(p, "zidane-zinedine")).toMatch(/fee_eur_m: is blank but fee_year is 2001/);
    expect(p.feeNeedsYear).toEqual([]);
  });
});

describe("numbers", () => {
  it("are refused unless plain, naming the row, column and value — every one of them", () => {
    players(KEEPER_OK, { ...ZIDANE, caps: "1,234", fee_eur_m: "€77m", apps: "506 apps" });
    expect(run()).toBe(1);
    const out = output();
    expect(out).toMatch(/row 3 {2}zidane-zinedine/);
    expect(out).toMatch(/caps: "1,234" is not a plain number/);
    expect(out).toMatch(/fee_eur_m: "€77m" is not a plain number/);
    expect(out).toMatch(/apps: "506 apps" is not a plain number/);
    expect(existsSync(join(playersDir(), "zidane-zinedine.yaml"))).toBe(false);
    expect(existsSync(join(playersDir(), "buffon-gianluigi.yaml"))).toBe(true);
  });

  it("leave whole-number and sign rules to the schema, named by column", () => {
    const p = plan([HEADER, row({ ...ZIDANE, caps: "10.5", apps: "-3" })].join("\n"));
    const problems = problemsFor(p, "zidane-zinedine");
    expect(problems).toMatch(/caps: must be a whole number/);
    expect(problems).toMatch(/apps: cannot be negative/);
  });
});

describe("images", () => {
  it("are joined from the image log without width, height or notes", () => {
    players(ZIDANE);
    write("image-log.csv", `${IMAGE_HEADER}\n${zidaneImage}\n`);
    expect(run()).toBe(0);
    expect(loadPlayer("zidane-zinedine").image).toEqual({
      file: "zidane-2008.jpg",
      author: "Jane Smith",
      licence: "CC-BY-4.0",
      source: "https://commons.wikimedia.org/wiki/File:Z.jpg",
    });
  });

  it("are left out for an image-log row with no file", () => {
    players(ZIDANE);
    write("image-log.csv", `${IMAGE_HEADER}\nzidane-zinedine,,,,,,,no free photo\n`);
    expect(run()).toBe(0);
    expect(loadPlayer("zidane-zinedine")).not.toHaveProperty("image");
    expect(output()).toMatch(/players with no image: 1 — zidane-zinedine/);
  });

  it("take a focus only when the player has an image", () => {
    players(ZIDANE, KEEPER_OK);
    write("image-log.csv", `${IMAGE_HEADER}\n${zidaneImage}\n`);
    write("focus.csv", "player_id,focus\nzidane-zinedine,50 15\nbuffon-gianluigi,40 20\n");
    expect(run()).toBe(0);
    expect((loadPlayer("zidane-zinedine").image as Record<string, unknown>).focus).toBe("50 15");
    expect(loadPlayer("buffon-gianluigi")).not.toHaveProperty("image");
    expect(output()).toMatch(/focus ids with no image: buffon-gianluigi/);
  });

  it("reject a malformed focus, naming the focus.csv row", () => {
    players(ZIDANE);
    write("image-log.csv", `${IMAGE_HEADER}\n${zidaneImage}\n`);
    write("focus.csv", "player_id,focus\nzidane-zinedine,50 150\n");
    expect(run()).toBe(1);
    expect(output()).toMatch(/focus\.csv row 2 focus: each focus percentage must be from 0 to 100/);
  });

  it("warn, without failing, about files missing from originals/", () => {
    players(ZIDANE);
    write(
      "image-log.csv",
      `${IMAGE_HEADER}\n${zidaneImage.replace("zidane-2008.jpg", "zz.jpg")}\n`,
    );
    expect(run()).toBe(0);
    expect(output()).toMatch(
      /image files not in originals\/ \(warning\):\n {4}zidane-zinedine: zz\.jpg/,
    );
  });
});

describe("invalid players", () => {
  it("are reported with every schema and deck problem, and nothing is written for them", () => {
    players(KEEPER_OK, {
      ...KEEPER,
      player_id: "keeper-two",
      club_goals: "3",
      igoals: "1",
      dob: "2030-01-01",
    });
    write(
      "image-log.csv",
      `${IMAGE_HEADER}\nkeeper-two,k.jpg,1,1,,fair-use,https://e.com/k.jpg,\n`,
    );
    expect(run()).toBe(1);

    const out = output();
    expect(out).toMatch(/row 3 {2}keeper-two/);
    expect(out).toMatch(/image-log\.csv row 2 author: an image needs an author/);
    expect(out).toMatch(/image-log\.csv row 2 licence:/);
    expect(existsSync(join(playersDir(), "keeper-two.yaml"))).toBe(false);
    expect(existsSync(join(playersDir(), "buffon-gianluigi.yaml"))).toBe(true);
    expect(out).toMatch(/1 row\(s\) skipped — the import is partial/);
  });

  it("run the deck checks too, reporting all of them", () => {
    const p = plan(
      [HEADER, row({ ...KEEPER, club_goals: "3", igoals: "1", dob: "2030-01-01" })].join("\n"),
    );
    const problems = problemsFor(p, "buffon-gianluigi");
    expect(problems).toMatch(/club_goals: goalkeepers are not eligible/);
    expect(problems).toMatch(/igoals: goalkeepers are not eligible/);
    expect(problems).toMatch(/dob: date of birth is in the future/);
  });

  it("are skipped, both of them, when an id repeats", () => {
    const p = plan([HEADER, row(ZIDANE), row(KEEPER_OK), row(ZIDANE)].join("\n"));
    expect([...p.files.keys()]).toEqual(["buffon-gianluigi"]);
    expect(p.skipped.map((s) => s.row)).toEqual([2, 4]);
    expect(p.duplicates).toEqual(["players.csv: zidane-zinedine on rows 2, 4"]);
  });

  it("include missing required cells", () => {
    const p = plan([HEADER, row({ ...ZIDANE, name: "" })].join("\n"));
    expect(problemsFor(p, "zidane-zinedine")).toMatch(/name: is required/);
  });

  it("keep their existing file untouched", () => {
    players(ZIDANE);
    expect(run()).toBe(0);
    const before = readPlayer("zidane-zinedine");
    players({ ...ZIDANE, caps: "lots" });
    expect(run()).toBe(1);
    expect(readPlayer("zidane-zinedine")).toBe(before);
    expect(output()).toMatch(/player files with no players\.csv row: none/);
  });
});

describe("the CSV files themselves", () => {
  it("fail the whole import on an unknown or missing column", () => {
    write("players.csv", HEADER.replace("club_goals", "club_gaols") + "\n" + row(ZIDANE) + "\n");
    expect(run()).toBe(1);
    expect(output()).toMatch(/unknown column\(s\) club_gaols/);
    expect(existsSync(playersDir())).toBe(false);
  });

  it("fail the whole import on any row whose field count differs from the header", () => {
    players(ZIDANE, KEEPER_OK);
    // An unquoted comma in the source URL splits it across two fields.
    write(
      "image-log.csv",
      `${IMAGE_HEADER}\n` +
        "zidane-zinedine,zidane-2008.jpg,1600,2400,Jane Smith,CC-BY-4.0," +
        "https://commons.wikimedia.org/wiki/File:Zidane,_2008.jpg,good\n",
    );
    write("focus.csv", "player_id,focus\nzidane-zinedine\n");
    expect(run()).toBe(1);
    const out = output();
    expect(out).toMatch(
      /image-log\.csv: row 2 has 9 fields, but the header has 8 — quote any value that contains a comma/,
    );
    expect(out).toMatch(/focus\.csv: row 2 has 1 fields, but the header has 2/);
    expect(existsSync(playersDir())).toBe(false);
  });

  it("apply the field count to players.csv too, short rows included", () => {
    write("players.csv", `${HEADER}\n${row(ZIDANE)},extra\n${row(KEEPER_OK).replace(/,+$/, "")}\n`);
    expect(run()).toBe(1);
    const out = output();
    expect(out).toMatch(/players\.csv: row 2 has 23 fields, but the header has 22/);
    expect(out).toMatch(/players\.csv: row 3 has 13 fields, but the header has 22/);
    expect(existsSync(playersDir())).toBe(false);
  });

  it("read a quoted value containing commas as one field", () => {
    players(ZIDANE);
    write(
      "image-log.csv",
      `${IMAGE_HEADER}\n` +
        'zidane-zinedine,zidane-2008.jpg,1600,2400,"Smith, Jane",CC-BY-4.0,' +
        '"https://commons.wikimedia.org/wiki/File:Zidane,_2008.jpg","good, sharp"\n',
    );
    expect(run()).toBe(0);
    expect(loadPlayer("zidane-zinedine").image).toMatchObject({
      author: "Smith, Jane",
      source: "https://commons.wikimedia.org/wiki/File:Zidane,_2008.jpg",
    });
  });

  it("fail without players.csv", () => {
    expect(run()).toBe(1);
    expect(output()).toMatch(/no players\.csv/);
  });

  it("report cross-file problems", () => {
    players(ZIDANE);
    write(
      "image-log.csv",
      `${IMAGE_HEADER}\n${zidaneImage}\nnobody-here,n.jpg,1,1,A,CC0,https://e.com/n,\n`,
    );
    write("focus.csv", "player_id,focus\nzidane-zinedine,50 15\nzidane-zinedine,50 20\n");
    expect(run()).toBe(1);
    const out = output();
    expect(out).toMatch(/image-log ids with no players row: nobody-here/);
    expect(out).toMatch(/focus\.csv: zidane-zinedine on rows 2, 3/);
    expect(out).toMatch(/focus\.csv: "zidane-zinedine" is on rows 2, 3 — keep one/);
  });
});

describe("files already in players/", () => {
  it("are reported, not deleted, when no row generates them", () => {
    players(ZIDANE);
    mkdirSync(playersDir());
    writeFileSync(join(playersDir(), "old-player.yaml"), "id: old-player\n");
    expect(run()).toBe(0);
    expect(existsSync(join(playersDir(), "old-player.yaml"))).toBe(true);
    expect(output()).toMatch(/kept \(--prune deletes them\):\n {4}old-player\.yaml/);
  });

  it("are deleted with --prune", () => {
    players(ZIDANE);
    mkdirSync(playersDir());
    writeFileSync(join(playersDir(), "old-player.yaml"), "id: old-player\n");
    writeFileSync(join(playersDir(), "zidane-zinedine.yml"), "id: zidane-zinedine\n");
    expect(run("--prune")).toBe(0);
    expect(readdirSync(playersDir()).sort()).toEqual(["zidane-zinedine.yaml"]);
  });

  it("are reported as changed when their contents differ", () => {
    players(ZIDANE);
    expect(run()).toBe(0);
    players({ ...ZIDANE, caps: "109" });
    expect(run()).toBe(0);
    expect(output()).toMatch(/1 written \(0 new, 1 changed\), 0 unchanged/);
    expect(output()).toMatch(/changed {2}zidane-zinedine/);
  });
});

describe("--dry-run", () => {
  it("writes and deletes nothing, but still reports and fails on skipped rows", () => {
    players(ZIDANE, { ...KEEPER_OK, caps: "x" });
    mkdirSync(playersDir());
    writeFileSync(join(playersDir(), "old-player.yaml"), "id: old-player\n");
    expect(run("--dry-run", "--prune")).toBe(1);
    expect(readdirSync(playersDir())).toEqual(["old-player.yaml"]);
    expect(output()).toMatch(/1 would be written/);
    expect(output()).toMatch(/would be deleted \(--prune\)/);
  });
});

describe("re-running", () => {
  it("with unchanged CSVs changes nothing on disk", () => {
    players(ZIDANE, KEEPER_OK);
    write("image-log.csv", `${IMAGE_HEADER}\n${zidaneImage}\n`);
    write("focus.csv", "player_id,focus\nzidane-zinedine,50 15\n");
    expect(run()).toBe(0);
    const first = new Map(
      readdirSync(playersDir()).map((f) => [f, readFileSync(join(playersDir(), f), "utf8")]),
    );
    const mtimes = readdirSync(playersDir()).map((f) => statSync(join(playersDir(), f)).mtimeMs);

    expect(run()).toBe(0);
    expect(output()).toMatch(/0 written \(0 new, 0 changed\), 2 unchanged/);
    for (const [f, text] of first) expect(readFileSync(join(playersDir(), f), "utf8")).toBe(text);
    expect(readdirSync(playersDir()).map((f) => statSync(join(playersDir(), f)).mtimeMs)).toEqual(
      mtimes,
    );
  });

  it("treats a CRLF checkout of the same file as unchanged", () => {
    players(ZIDANE);
    expect(run()).toBe(0);
    const path = join(playersDir(), "zidane-zinedine.yaml");
    writeFileSync(path, readFileSync(path, "utf8").replace(/\n/g, "\r\n"));
    expect(run()).toBe(0);
    expect(output()).toMatch(/1 unchanged/);
  });
});
