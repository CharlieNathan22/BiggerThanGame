import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PLACEHOLDER_ID, databaseConfig, ownerSql, seedSql } from "../db.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const toml = readFileSync(resolve(root, "wrangler.toml"), "utf8");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};

describe("local development never touches the real database", () => {
  it("has no remote D1 setting in wrangler.toml", () => {
    expect(toml).not.toMatch(/remote\s*=\s*true/);
    expect(databaseConfig(toml)).toEqual({ name: "biggerthangame", id: PLACEHOLDER_ID });
  });

  it("passes --remote in no package script: only db.ts's migrate:remote and owner can, after asking", () => {
    for (const [name, script] of Object.entries(pkg.scripts)) {
      expect(script, name).not.toContain("--remote");
    }
    expect(pkg.scripts["db:migrate:local"]).toBe("tsx scripts/db.ts migrate:local");
    expect(pkg.scripts["db:seed:local"]).toBe("tsx scripts/db.ts seed:local");
    expect(pkg.scripts["db:reset:local"]).toBe("tsx scripts/db.ts reset:local");
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
    expect(ownerSql("flag-name", id)).toBe(`UPDATE scores SET name_flagged = 1 WHERE id = '${id}'`);
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
