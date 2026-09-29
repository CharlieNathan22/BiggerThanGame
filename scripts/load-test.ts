/**
 * `pnpm load:local` — a load test of Endless against **`wrangler dev` only**:
 * many runs at once, each started, answered to its end and published, timing
 * `/api/run/start`, `/api/round/guess` and `/api/run/submit`.
 *
 * It refuses any address but this machine's: never point it at production.
 * Start the Worker first (`pnpm dev:api`, whose .dev.vars carries Turnstile's
 * always-pass test secret). Answers are right, from the built deck, until each
 * run's chosen length, then wrong; they come as fast as the server answers, so
 * every published run will be shadow-flagged, which is fine here.
 *
 * Every request from one address shares the per-IP limits (run starts,
 * submissions, the flood backstop), so each simulated player sends its own
 * `cf-connecting-ip`; wrangler dev passes it through, Cloudflare wouldn't. 429s
 * are counted apart from errors.
 *
 *   pnpm load:local [--url http://127.0.0.1:8787] [--players 50] [--runs 4] [--rounds 12]
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { valueOf } from "@bt/core";
import type { GuessResponse, Player, RoundPayload, RunStartResponse } from "@bt/core";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Cloudflare's always-pass Turnstile test token, which the test secret accepts. */
const DUMMY_TURNSTILE = "XXXX.DUMMY.TOKEN.XXXX";

export function isLocal(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  } catch {
    return false;
  }
}

interface Sample {
  readonly ms: number;
  readonly status: number;
}

export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, i)] ?? 0;
}

export interface Summary {
  readonly requests: number;
  readonly ok: number;
  readonly limited: number;
  readonly errors: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
}

export function summarise(samples: readonly Sample[]): Summary {
  const ok = samples.filter((s) => s.status >= 200 && s.status < 300);
  const ms = ok.map((s) => s.ms).sort((a, b) => a - b);
  return {
    requests: samples.length,
    ok: ok.length,
    limited: samples.filter((s) => s.status === 429).length,
    errors: samples.filter((s) => s.status === 0 || (s.status >= 400 && s.status !== 429)).length,
    p50: Math.round(percentile(ms, 50)),
    p95: Math.round(percentile(ms, 95)),
    p99: Math.round(percentile(ms, 99)),
    max: Math.round(ms.at(-1) ?? 0),
  };
}

function arg(args: readonly string[], name: string, fallback: string): string {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : (args[i + 1] ?? fallback);
}

async function main(args: readonly string[]): Promise<number> {
  const base = arg(args, "url", "http://127.0.0.1:8787");
  if (!isLocal(base)) {
    console.error(
      `load-test: refusing ${base}. Only wrangler dev on this machine, never production.`,
    );
    return 1;
  }
  const players = Number(arg(args, "players", "50"));
  const runsEach = Number(arg(args, "runs", "4"));
  const maxRounds = Number(arg(args, "rounds", "12"));
  const deck = JSON.parse(
    readFileSync(join(root, "packages", "deck", "dist", "deck.full.json"), "utf8"),
  ) as { players: Player[] };
  const byId = new Map(deck.players.map((p) => [p.id, p]));

  const samples: Record<"start" | "guess" | "submit", Sample[]> = {
    start: [],
    guess: [],
    submit: [],
  };
  const call = async <T>(
    kind: keyof typeof samples,
    path: string,
    body: unknown,
    ip: string,
  ): Promise<{ status: number; body: T | null }> => {
    const began = performance.now();
    try {
      const res = await fetch(`${base}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", "cf-connecting-ip": ip },
        body: JSON.stringify(body),
      });
      const json = res.ok ? ((await res.json()) as T) : null;
      if (!res.ok) await res.text();
      samples[kind].push({ ms: performance.now() - began, status: res.status });
      return { status: res.status, body: json };
    } catch {
      samples[kind].push({ ms: performance.now() - began, status: 0 });
      return { status: 0, body: null };
    }
  };

  const right = (runId: string, round: RoundPayload): "higher" | "lower" => {
    const date = new Date(
      `${runId.slice(0, 4)}-${runId.slice(4, 6)}-${runId.slice(6, 8)}T00:00:00Z`,
    );
    const challenger = byId.get(round.challenger.id);
    const value = challenger === undefined ? undefined : valueOf(challenger, round.stat.key, date);
    return value !== undefined && value > round.anchor.value ? "higher" : "lower";
  };

  const player = async (n: number): Promise<void> => {
    const ip = `10.${Math.floor(n / 250)}.${n % 250}.${1 + (n % 7)}`;
    for (let r = 0; r < runsEach; r += 1) {
      const started = await call<RunStartResponse>(
        "start",
        "/api/run/start",
        { mode: "endless", turnstileToken: DUMMY_TURNSTILE },
        ip,
      );
      if (started.body === null) continue;
      const length = 1 + ((n + r) % maxRounds);
      let token = started.body.token;
      let round = started.body.round;
      let result: string | null = null;
      for (let i = 1; ; i += 1) {
        const pick = right(started.body.runId, round);
        const guess = i > length ? (pick === "higher" ? "lower" : "higher") : pick;
        const res = await call<GuessResponse>("guess", "/api/round/guess", { token, guess }, ip);
        if (res.body === null) break;
        if (!("next" in res.body)) {
          result = res.body.result;
          break;
        }
        token = res.body.token;
        round = res.body.next;
      }
      if (result !== null && length > 0) {
        await call(
          "submit",
          "/api/run/submit",
          {
            token: result,
            nickname: `Load Test ${n}`,
            deviceId: crypto.randomUUID(),
            turnstileToken: DUMMY_TURNSTILE,
          },
          ip,
        );
      }
    }
  };

  console.log(`load-test: ${players} players × ${runsEach} runs against ${base}\n`);
  const began = performance.now();
  await Promise.all(Array.from({ length: players }, (_, n) => player(n)));
  const seconds = (performance.now() - began) / 1000;
  const rows = Object.entries(samples).map(([endpoint, s]) => ({ endpoint, ...summarise(s) }));
  console.table(rows);
  const total = rows.reduce((a, r) => a + r.requests, 0);
  console.log(
    `\n${total} requests in ${seconds.toFixed(1)} s: ${(total / seconds).toFixed(1)} a second`,
  );
  return 0;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(await main(process.argv.slice(2)));
}
