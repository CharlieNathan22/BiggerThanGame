/**
 * D1, as far as scores.ts uses it, over Node's own SQLite (`node:sqlite`, in
 * Node 22) — so the board SQL is tested for real, against the real migrations,
 * with no new dependency. Each call makes a fresh in-memory database.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import type { SQLInputValue } from "node:sqlite";
import type { D1Like, D1Statement } from "../scores.js";

const MIGRATIONS = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "migrations");

export interface TestD1 extends D1Like {
  /** Runs raw SQL, for arranging a test. */
  exec(sql: string): void;
  /** Every row of a query, for asserting on. */
  rows<T>(sql: string, ...values: SQLInputValue[]): T[];
  /** How many statements have run, to show a cached read never reached the database. */
  readonly queries: number;
}

export function sqliteD1(): TestD1 {
  const db = new DatabaseSync(":memory:");
  for (const file of readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    db.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
  }
  let queries = 0;

  const statement = (source: string, values: unknown[] = []): D1Statement => {
    // D1 binds `?N` by number; node:sqlite won't bind those positionally, so
    // each becomes a plain `?` with its value in order of appearance.
    const order: number[] = [];
    const sql = source.replace(/\?(\d+)/g, (_, i: string) => {
      order.push(Number(i) - 1);
      return "?";
    });
    const args = () =>
      (order.length > 0 ? order.map((i) => values[i]) : values).map((v) =>
        v === undefined ? null : v,
      ) as SQLInputValue[];
    return {
      bind: (...next) => statement(source, next),
      all: async <T>() => {
        queries += 1;
        return { results: db.prepare(sql).all(...args()) as T[] };
      },
      first: async <T>() => {
        queries += 1;
        return (db.prepare(sql).get(...args()) as T | undefined) ?? null;
      },
      run: async () => {
        queries += 1;
        const result = db.prepare(sql).run(...args());
        return { meta: { changes: Number(result.changes) } };
      },
    };
  };

  return {
    prepare: (sql) => statement(sql),
    batch: async (statements) => {
      db.exec("BEGIN");
      try {
        const out = [];
        for (const s of statements) out.push(await s.run());
        db.exec("COMMIT");
        return out;
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },
    exec: (sql) => db.exec(sql),
    rows: <T>(sql: string, ...values: SQLInputValue[]) => db.prepare(sql).all(...values) as T[],
    get queries() {
      return queries;
    },
  };
}
