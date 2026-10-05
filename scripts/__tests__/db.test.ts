import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  PLACEHOLDER_ID,
  asksRemote,
  d1Block,
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
