/**
 * `pnpm stats`: argument parsing, the saved queries, the SQL API call and the
 * printing — with `fetch` and the environment injected, so nothing here reads
 * `.env` or touches the network.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { DATASET } from "../../worker/src/analytics.js";
import { DEFAULT_QUERIES, QUERIES, QUERY_NAMES, formatTable } from "../stats-queries.js";
import type { Row } from "../stats-queries.js";
import { SQL_API, parseArgs, runStats } from "../stats.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ACCOUNT = "0123456789abcdef0123456789abcdef";
const TOKEN = "token-that-must-never-be-printed";

function sqlResponse(columns: string[], rows: Row[]): Response {
  return new Response(JSON.stringify({ meta: columns.map((name) => ({ name })), data: rows }));
}

function deps(fetchImpl: typeof fetch, env: Record<string, string | undefined> = {}) {
  const printed: string[] = [];
  return {
    printed,
    deps: {
      env: { CF_ACCOUNT_ID: ACCOUNT, CF_ANALYTICS_TOKEN: TOKEN, ...env },
      fetch: fetchImpl,
      print: (text: string) => void printed.push(text),
    },
  };
}

describe("arguments", () => {
  it("shows the start/end summary for the last 7 days by default", () => {
    expect(parseArgs([])).toEqual({ queries: DEFAULT_QUERIES, options: { days: 7 }, list: false });
    expect(DEFAULT_QUERIES).toEqual(["summary", "scores"]);
  });

  it("takes query names, all, --days and --deck", () => {
    expect(parseArgs(["streaks", "distance", "--days", "30"])).toEqual({
      queries: ["streaks", "distance"],
      options: { days: 30 },
      list: false,
    });
    expect(parseArgs(["all"]).queries).toEqual(QUERY_NAMES);
    expect(parseArgs(["--", "--deck", "legends-107-e68a4e1b"]).options).toEqual({
      days: 7,
      deck: "legends-107-e68a4e1b",
    });
  });

  it("refuses anything it doesn't know", () => {
    expect(() => parseArgs(["everything"])).toThrow(/unknown query or option/);
  });

  it.each([["0"], ["93"], ["1.5"], ["seven"]])("refuses --days %s", async (days) => {
    const fetchSpy = vi.fn();
    const { printed, deps: d } = deps(fetchSpy);
    expect(await runStats(["--days", days], d)).toBe(1);
    expect(printed.join("\n")).toMatch(/days must be a whole number from 1 to 92/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses a --deck that isn't a deck version, so nothing can be spliced into the SQL", async () => {
    const fetchSpy = vi.fn();
    const { deps: d } = deps(fetchSpy);
    expect(await runStats(["--deck", "x' OR 1=1 --"], d)).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("the saved queries", () => {
  it.each(QUERY_NAMES)(
    "%s reads the dataset, in the window, counting by sample interval",
    (name) => {
      const sql = QUERIES[name].sql({ days: 7 });
      expect(sql).toContain(`FROM ${DATASET}\n`);
      expect(sql).toContain("timestamp > NOW() - INTERVAL '7' DAY");
      expect(sql).not.toMatch(/count\(/i);
      expect(sql).not.toMatch(/\bFORMAT\b/);
    },
  );

  it("adds the deck filter only when asked", () => {
    expect(QUERIES.summary.sql({ days: 7 })).not.toContain("blob4");
    expect(QUERIES.summary.sql({ days: 30, deck: "legends-107-e68a4e1b" })).toContain(
      "INTERVAL '30' DAY\n  AND blob4 = 'legends-107-e68a4e1b'",
    );
  });

  it("are printed in ARCHITECTURE.md exactly as they run", () => {
    const doc = readFileSync(resolve(root, "docs", "ARCHITECTURE.md"), "utf8");
    for (const name of QUERY_NAMES) {
      expect(doc, `ARCHITECTURE.md is missing or has a stale "${name}" query`).toContain(
        "```sql\n" + QUERIES[name].sql({ days: 7 }) + "\n```",
      );
    }
  });

  it("works out who left after each round", () => {
    const rows = QUERIES.dropoff.post([
      { mode: "friendly", round: 1, reached: "100", correct: "90", correct_pct: 90 },
      { mode: "friendly", round: 2, reached: "85", correct: "70", correct_pct: 82.4 },
      { mode: "friendly", round: 3, reached: "66", correct: "50", correct_pct: 75.8 },
    ]);
    expect(rows.map((r) => r.left)).toEqual([5, 4, ""]);
  });

  it("works out each stat's share of its mode's answers", () => {
    const rows = QUERIES.stats.post([
      { mode: "friendly", stat: "caps", tier: "basic", answers: "300", correct_pct: 80 },
      { mode: "friendly", stat: "ct", tier: "rare", answers: "100", correct_pct: 60 },
    ]);
    expect(rows.map((r) => r.share_pct)).toEqual([75, 25]);
  });

  it("blanks the end columns on a start", () => {
    const rows = QUERIES.latest.post([
      { event: "start", end_reason: "", score: 0 },
      { event: "end", end_reason: "won", score: 20 },
    ]);
    expect(rows).toEqual([
      { event: "start", end_reason: "", score: "" },
      { event: "end", end_reason: "won", score: 20 },
    ]);
  });
});

describe("formatTable", () => {
  it("aligns text left and numbers right, including numbers sent as strings", () => {
    expect(
      formatTable(
        ["mode", "started", "win_pct"],
        [
          { mode: "friendly", started: "1204", win_pct: 9.6 },
          { mode: "endless", started: "7", win_pct: null },
        ],
      ),
    ).toBe(
      [
        "  mode      started  win_pct",
        "  --------  -------  -------",
        "  friendly     1204      9.6",
        "  endless         7",
      ].join("\n"),
    );
  });

  it("says when there's nothing", () => {
    expect(formatTable(["mode"], [])).toBe("  (no rows)");
  });
});

describe("running", () => {
  it("posts each query to the SQL API with the token, and prints tables", async () => {
    const fetchSpy = vi.fn<typeof fetch>(async () =>
      sqlResponse(["mode", "started"], [{ mode: "friendly", started: "12" }]),
    );
    const { printed, deps: d } = deps(fetchSpy);
    expect(await runStats([], d)).toBe(0);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe(SQL_API(ACCOUNT));
    expect(url).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/analytics_engine/sql`,
    );
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({ authorization: `Bearer ${TOKEN}` });
    expect(init?.body).toBe(`${QUERIES.summary.sql({ days: 7 })}\nFORMAT JSON`);

    const out = printed.join("\n");
    expect(out).toContain("Last 7 days.");
    expect(out).toContain(QUERIES.summary.title);
    expect(out).toContain("  friendly       12");
    expect(out).not.toContain(TOKEN);
    expect(out).not.toContain(ACCOUNT);
  });

  it("lists the queries without needing credentials", async () => {
    const fetchSpy = vi.fn();
    const { printed, deps: d } = deps(fetchSpy, {
      CF_ACCOUNT_ID: undefined,
      CF_ANALYTICS_TOKEN: undefined,
    });
    expect(await runStats(["--list"], d)).toBe(0);
    expect(printed).toHaveLength(QUERY_NAMES.length);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("names the missing settings, and nothing else", async () => {
    const fetchSpy = vi.fn();
    const { printed, deps: d } = deps(fetchSpy, { CF_ANALYTICS_TOKEN: "" });
    expect(await runStats([], d)).toBe(1);
    expect(printed.join("\n")).toMatch(/CF_ACCOUNT_ID and CF_ANALYTICS_TOKEN must be set in \.env/);
    expect(printed.join("\n")).not.toContain(ACCOUNT);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("stops on an API error with a hint, and never prints the token", async () => {
    const fetchSpy = vi.fn(
      async () => new Response('{"errors":[{"message":"Authentication error"}]}', { status: 401 }),
    );
    const { printed, deps: d } = deps(fetchSpy as unknown as typeof fetch);
    expect(await runStats(["all"], d)).toBe(1);
    expect(fetchSpy).toHaveBeenCalledOnce();
    const out = printed.join("\n");
    expect(out).toContain("HTTP 401");
    expect(out).toContain("Account Analytics");
    expect(out).not.toContain(TOKEN);
  });

  it("explains a missing dataset", async () => {
    const fetchSpy = vi.fn(
      async () => new Response("Code: 60. DB::Exception: Unknown table", { status: 422 }),
    );
    const { printed, deps: d } = deps(fetchSpy as unknown as typeof fetch);
    expect(await runStats([], d)).toBe(1);
    expect(printed.join("\n")).toContain("created by the first event after a deploy");
  });
});
