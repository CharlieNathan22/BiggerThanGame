/**
 * `pnpm stats` — runs the saved Analytics Engine queries (stats-queries.ts)
 * against the SQL API and prints tables. ARCHITECTURE.md §19; set-up in
 * CLAUDE.md.
 *
 *   pnpm stats                          the start/end summary, last 7 days
 *   pnpm stats streaks distance         named queries (pnpm stats --list)
 *   pnpm stats all                      every query
 *   pnpm stats --days 30                a longer window (up to 92)
 *   pnpm stats --deck legends-107-e68a4e1b   one deck version only
 *   pnpm stats run 20260928-<uuid>      every answer in one run, with the gaps
 *
 * Reads CF_ACCOUNT_ID and CF_ANALYTICS_TOKEN from the environment, loading
 * `.env` first when there is one. The token is a Cloudflare API token with
 * read-only Account Analytics permission. Neither value is ever printed.
 *
 * No dependencies: Node's own `fetch` and `process.loadEnvFile`.
 */

import { existsSync } from "node:fs";
import {
  ALL_QUERIES,
  DEFAULT_DAYS,
  DEFAULT_QUERIES,
  QUERIES,
  QUERY_NAMES,
  formatTable,
  isQueryName,
} from "./stats-queries.js";
import type { QueryName, QueryOptions, Row, SavedQuery } from "./stats-queries.js";

export const SQL_API = (account: string): string =>
  `https://api.cloudflare.com/client/v4/accounts/${account}/analytics_engine/sql`;

export interface Args {
  readonly queries: readonly QueryName[];
  readonly options: QueryOptions;
  readonly list: boolean;
}

export function parseArgs(argv: readonly string[]): Args {
  const queries: QueryName[] = [];
  let days = DEFAULT_DAYS;
  let deck: string | undefined;
  let run: string | undefined;
  let list = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--") continue;
    if (arg === "--list") list = true;
    else if (arg === "--days") days = Number(argv[++i]);
    else if (arg === "--deck") deck = argv[++i];
    else if (arg === "all") queries.push(...ALL_QUERIES);
    else if (arg === "run") {
      // The run key follows; stats-queries.ts checks it before it reaches the SQL.
      queries.push("run");
      run = argv[++i];
    } else if (isQueryName(arg)) queries.push(arg);
    else throw new Error(`unknown query or option "${arg}" (pnpm stats --list)`);
  }
  return {
    queries: queries.length > 0 ? [...new Set(queries)] : DEFAULT_QUERIES,
    options: {
      days,
      ...(deck !== undefined ? { deck } : {}),
      ...(run !== undefined ? { run } : {}),
    },
    list,
  };
}

interface SqlResponse {
  readonly meta?: readonly { readonly name: string }[];
  readonly data?: readonly Row[];
}

export interface StatsDeps {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly fetch: typeof fetch;
  readonly print: (text: string) => void;
}

/** Runs the queries `argv` names and prints them. Returns the exit code. */
export async function runStats(argv: readonly string[], deps: StatsDeps): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(argv);
    // Renders every query once, so a bad --days or --deck fails before any request.
    for (const name of args.queries) QUERIES[name].sql(args.options);
  } catch (err) {
    deps.print(`stats: ${(err as Error).message}`);
    return 1;
  }

  if (args.list) {
    for (const name of QUERY_NAMES) {
      const query: SavedQuery = QUERIES[name];
      const usage = query.needsRunKey ? `${name} <runKey>` : name;
      deps.print(`  ${usage.padEnd(15)} ${query.title}`);
    }
    return 0;
  }

  const account = deps.env.CF_ACCOUNT_ID;
  const token = deps.env.CF_ANALYTICS_TOKEN;
  if (!account || !token) {
    deps.print(
      "stats: CF_ACCOUNT_ID and CF_ANALYTICS_TOKEN must be set in .env — see CLAUDE.md, " +
        '"Gameplay analytics"',
    );
    return 1;
  }

  const { days, deck } = args.options;
  deps.print(`Last ${days} day${days === 1 ? "" : "s"}${deck ? `, deck ${deck}` : ""}.`);
  for (const name of args.queries) {
    const query: SavedQuery = QUERIES[name];
    let result: SqlResponse;
    try {
      const res = await deps.fetch(SQL_API(account), {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: `${query.sql(args.options)}\nFORMAT JSON`,
      });
      const text = await res.text();
      if (!res.ok) {
        deps.print(`\nstats: ${name} failed: HTTP ${res.status}\n  ${text.slice(0, 500)}`);
        if (res.status === 401 || res.status === 403) {
          deps.print("  Check the token has Account › Account Analytics › Read.");
        } else if (/unknown table|does not exist/i.test(text)) {
          deps.print("  No dataset yet: it is created by the first event after a deploy.");
        }
        return 1;
      }
      result = JSON.parse(text) as SqlResponse;
    } catch (err) {
      deps.print(`\nstats: ${name} failed: ${(err as Error).message}`);
      return 1;
    }

    const columns = (result.meta ?? []).map((m) => m.name);
    const rows = query.post ? query.post([...(result.data ?? [])]) : [...(result.data ?? [])];
    for (const r of rows)
      for (const key of Object.keys(r)) if (!columns.includes(key)) columns.push(key);
    deps.print(`\n${query.title}\n  ${query.about}\n\n${formatTable(columns, rows)}`);
    if (query.summary) deps.print(`\n${query.summary(rows)}`);
  }
  return 0;
}

// Only when run directly, so the test can import this module.
if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/stats.ts")) {
  if (existsSync(".env")) process.loadEnvFile(".env");
  runStats(process.argv.slice(2), {
    env: process.env,
    fetch,
    print: (text) => console.log(text),
  }).then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      console.error(err);
      process.exitCode = 1;
    },
  );
}
