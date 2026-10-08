import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { dailyBoard } from "../../worker/src/daily-scores.js";
import { sqliteD1 } from "../../worker/src/__tests__/d1-sqlite.js";
import {
  PLACEHOLDER_ID,
  SEED_TAKEN_NAME,
  SEED_WINNER,
  asksRemote,
  d1Block,
  dailySeedSql,
  databaseConfig,
  localArgs,
  ownerSql,
  seedSql,
} from "../db.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const toml = readFileSync(resolve(root, "wrangler.toml"), "utf8");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};

describe("local development never touches the real database", () => {
  it("has no remote setting on the D1 binding in wrangler.toml", () => {
    const block = d1Block(toml);
    expect(block).toBeDefined();
    expect(block).toContain('binding = "DB"');
    // remote, experimental_remote, preview_remote…: any of them would send `wrangler dev`'s
    // database calls to the real one.
    expect(block).not.toMatch(/^\s*[a-z_]*remote[a-z_]*\s*=/m);
    expect(toml).not.toMatch(/remote\s*=\s*true/);
  });

  it("would catch a remote setting, and reads only the D1 block", () => {
    const remoteKey = /^\s*[a-z_]*remote[a-z_]*\s*=/m;
    for (const key of ["remote", "experimental_remote", "preview_remote"]) {
      const sample = ["[[d1_databases]]", 'binding = "DB"', `${key} = true`, "", "[triggers]"];
      expect(d1Block(sample.join("\n")), key).toMatch(remoteKey);
    }
    const later = ["[[d1_databases]]", 'binding = "DB"', "", "[[services]]", "remote = true"];
    expect(d1Block(later.join("\n"))).not.toMatch(remoteKey);
  });

  it("names the real database with a valid id, the placeholder or the one created on deploy day", () => {
    const config = databaseConfig(toml);
    expect(config?.name).toBe("biggerthangame");
    expect(config?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(PLACEHOLDER_ID).toMatch(/^0{8}-0{4}-0{4}-0{4}-0{12}$/);
  });

  it("passes --remote in no package script: only db.ts's migrate:remote and owner can, after asking", () => {
    for (const [name, script] of Object.entries(pkg.scripts)) {
      expect(asksRemote(script.split(/\s+/)), name).toBe(false);
    }
    for (const name of ["dev", "dev:worker", "dev:web", "dev:api"]) {
      expect(pkg.scripts[name], name).toBeDefined();
      expect(pkg.scripts[name], name).not.toMatch(/--(x-)?remote/);
    }
    expect(pkg.scripts["db:migrate:local"]).toBe("tsx scripts/db.ts migrate:local");
    expect(pkg.scripts["db:seed:local"]).toBe("tsx scripts/db.ts seed:local");
    expect(pkg.scripts["db:reset:local"]).toBe("tsx scripts/db.ts reset:local");
  });

  it("runs the local commands with --local, never --remote", () => {
    // reset:local deletes the local state, then runs the migrate.
    for (const args of [localArgs("migrate"), localArgs("seed")]) {
      expect(args).toContain("--local");
      expect(asksRemote(args)).toBe(false);
    }
    expect(localArgs("seed", ".wrangler/seed.sql")).toContain("--file=.wrangler/seed.sql");
  });

  it("refuses --remote handed to a local command", () => {
    for (const flag of ["--remote", "--remote=true", "--x-remote-bindings"]) {
      expect(asksRemote(["--date", "2026-10-05", flag]), flag).toBe(true);
    }
    expect(asksRemote(["--date", "2026-10-05", "--local"])).toBe(false);
  });

  it("migrates the local database before pnpm dev starts", () => {
    expect(pkg.scripts.dev).toContain("pnpm db:migrate:local");
    expect(pkg.scripts["dev:api"]).toContain("pnpm db:migrate:local");
    expect(pkg.scripts["dev:worker"]).toContain("--test-scheduled");
  });
});

describe("ownerSql", () => {
  const id = "0f1e2d3c-4b5a-4968-8776-655443322110";

  it("updates one score by id", () => {
    expect(ownerSql("flag-name", id)).toBe(
      `UPDATE scores SET name_flagged = 1 WHERE id = '${id}'; ` +
        `UPDATE daily_entries SET name_flagged = 1 WHERE id = '${id}'`,
    );
    expect(ownerSql("unflag-name", id)).toContain("name_flagged = 0");
    expect(ownerSql("shadow", id)).toContain("shadow = 1");
    expect(ownerSql("unshadow", id)).toContain("shadow = 0, shadow_reason = NULL");
  });

  it("refuses anything that isn't a score id", () => {
    for (const bad of ["", "1 OR 1=1", `${id}' OR '1'='1`, "seed-1"]) {
      expect(() => ownerSql("shadow", bad)).toThrow(/not a score id/);
    }
  });

  it("finds by the normalised name, quotes escaped", () => {
    expect(ownerSql("find", "O'Neill 10")).toContain("nickname_normalised = 'oneilio'");
    expect(ownerSql("find", "x' OR '1'='1")).not.toMatch(/'1'='1/);
  });

  it("finds Daily Ranked entries too", () => {
    expect(ownerSql("find", "TakenName")).toContain("FROM daily_entries");
  });
});

describe("seedSql", () => {
  const today = new Date("2026-09-30T12:00:00Z"); // a Wednesday
  const sql = seedSql(today);
  const rows = sql
    .split("\n")
    .filter((l) => l.startsWith("('"))
    .map((l) => l.replace(/[,;]$/, ""));

  it("replaces an earlier seed and only seed rows", () => {
    expect(sql.startsWith("DELETE FROM scores WHERE run_id LIKE 'seed-%';")).toBe(true);
    expect(rows).toHaveLength(320 + 60);
    expect(seedSql(today)).toBe(sql);
  });

  it("spreads over today, yesterday, this week, this month and before", () => {
    const days = new Set(rows.map((r) => Number(/'endless', (\d{8})/.exec(r)?.[1])));
    for (const day of [20260930, 20260929, 20260928, 20260915]) expect(days).toContain(day);
    expect([...days].some((d) => d < 20260901)).toBe(true);
    expect([...days].every((d) => d <= 20260930)).toBe(true);
  });

  it("gives each a thinking time and mostly a country, some none", () => {
    const countries = rows.map((r) => /, (\d+), ('[A-Z]{2}'|NULL), 'seed-/.exec(r)?.[2]);
    expect(countries.every((c) => c !== undefined)).toBe(true);
    expect(countries.filter((c) => c === "NULL").length).toBeGreaterThan(10);
    expect(new Set(countries.filter((c) => c !== "NULL")).size).toBeGreaterThan(10);
  });

  it("puts sixty devices on top today, tied at ranks 10–11 and 50–51", () => {
    const top = rows
      .filter((r) => r.includes("-top-"))
      .map((r) => Number(/'endless', 20260930, '[^']*', '[^']*', (\d+),/.exec(r)?.[1]));
    expect(top).toHaveLength(60);
    expect(top[9]).toBe(top[10]);
    expect(top[49]).toBe(top[50]);
    expect(new Set(top).size).toBe(58);
    const others = rows
      .filter((r) => !r.includes("-top-"))
      .map((r) => Number(/'endless', \d{8}, '[^']*', '[^']*', (\d+),/.exec(r)?.[1]));
    expect(Math.max(...others)).toBeLessThan(Math.min(...top));
  });

  it("includes shadowed scores and retired names", () => {
    expect(rows.filter((r) => r.endsWith(", 1, 'seed')")).length).toBeGreaterThan(3);
    expect(rows.filter((r) => /, 1, [01], (NULL|'seed')\)$/.test(r)).length).toBeGreaterThan(2);
  });
});

describe("dailySeedSql", () => {
  const epoch = Date.UTC(2026, 9, 1);
  const today = new Date("2026-10-12T12:00:00Z"); // Game 12

  it("seeds today's game and the one before into the real schema, with a taken name", async () => {
    const db = sqliteD1();
    db.exec(dailySeedSql(today, epoch));
    const games = db.rows<{ game_no: number; n: number }>(
      "SELECT game_no, COUNT(*) AS n FROM daily_entries GROUP BY game_no ORDER BY game_no",
    );
    expect(games).toEqual([
      { game_no: 11, n: 140 },
      { game_no: 12, n: 30 },
    ]);
    expect(
      db.rows("SELECT game_no FROM daily_entries WHERE nickname = ?", SEED_TAKEN_NAME),
    ).toEqual([{ game_no: 12 }]);
    const board = await dailyBoard(db, 11);
    expect(board.entries[0]).toMatchObject({
      nickname: SEED_WINNER,
      score: 23,
      perfect: true,
      bonus: 3,
    });
    expect(board.entries[9]!.score).toBe(board.entries[10]!.score);
    // Every row's marks agree with its score.
    for (const row of db.rows<{ score: number; correct: number; bonus: number; results: string }>(
      "SELECT score, correct, bonus, results FROM daily_entries",
    )) {
      expect(
        row.results
          .slice(0, 20)
          .split("")
          .filter((c) => c === "1").length,
      ).toBe(row.correct);
      expect(row.correct + row.bonus).toBe(row.score);
    }
  });

  it("replaces an earlier seed, and is the same for the same day", () => {
    const sql = dailySeedSql(today, epoch);
    expect(sql.startsWith("DELETE FROM daily_entries WHERE run_key LIKE 'seed-%';")).toBe(true);
    expect(dailySeedSql(today, epoch)).toBe(sql);
    const db = sqliteD1();
    db.exec(sql);
    db.exec(sql);
    expect(db.rows("SELECT COUNT(*) AS n FROM daily_entries")).toEqual([{ n: 170 }]);
  });

  it("seeds nothing before Game 1", () => {
    expect(dailySeedSql(new Date("2026-09-20T12:00:00Z"), epoch)).toBe(
      "DELETE FROM daily_entries WHERE run_key LIKE 'seed-%';\n",
    );
  });
});
