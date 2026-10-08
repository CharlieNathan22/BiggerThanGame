/**
 * The boards' D1 database, from the command line (ARCHITECTURE.md §10).
 *
 * Everything local runs against wrangler's **local** D1 (Miniflare's state
 * under .wrangler/), never the real database:
 *
 *   pnpm db:migrate:local           apply migrations/ locally (pnpm dev does it first)
 *   pnpm db:seed:local [--date D]   a few hundred fake scores around day D (default today),
 *                                   and Daily Ranked entries for D's game and the one before
 *   pnpm db:reset:local             wipe the local database and migrate it again
 *
 * For the owner only, against production, each asking first:
 *
 *   pnpm db:migrate:remote          apply migrations/ to the real database
 *   pnpm db:owner flag-name <id>    retire a score's nickname ("Retired name"), score kept
 *   pnpm db:owner unflag-name <id>
 *   pnpm db:owner shadow <id>       hide a score from everyone but its owner
 *   pnpm db:owner unshadow <id>
 *   pnpm db:owner find <nickname>   list scores under a nickname, to find the id
 *
 * Each acts on Endless's scores and Daily Ranked's entries alike: ids are
 * uuids, never shared between the two.
 *
 * `db:owner` takes `--local` to try it on the local database instead.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import {
  DAILY_QUESTIONS,
  DAY_MS,
  createRng,
  dailyEpochMs,
  dayKey,
  gameNoAt,
  gameStartsAt,
  generateNickname,
  isGame,
  normaliseNickname,
  periodOf,
  startOfDay,
} from "@bt/core";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BINDING = "DB";

// ---------------------------------------------------------------- pure parts

/** The database's name and id from wrangler.toml. */
export function databaseConfig(toml: string): { name: string; id: string } | undefined {
  const block = toml.split("[[d1_databases]]")[1];
  if (block === undefined) return undefined;
  const name = /database_name\s*=\s*"([^"]+)"/.exec(block)?.[1];
  const id = /database_id\s*=\s*"([^"]+)"/.exec(block)?.[1];
  return name !== undefined && id !== undefined ? { name, id } : undefined;
}

/** The id wrangler.toml holds until the owner creates the real database. */
export const PLACEHOLDER_ID = "00000000-0000-0000-0000-000000000000";

/**
 * Just the `[[d1_databases]]` block of wrangler.toml, up to the next table
 * header, or undefined when there's none.
 */
export function d1Block(toml: string): string | undefined {
  const start = toml.indexOf("[[d1_databases]]");
  if (start === -1) return undefined;
  const rest = toml.slice(start + "[[d1_databases]]".length);
  const next = rest.search(/^\s*\[/m);
  return next === -1 ? rest : rest.slice(0, next);
}

/** Whether a command's arguments ask wrangler for the real database. */
export function asksRemote(args: readonly string[]): boolean {
  return args.some((a) => a === "--remote" || a.startsWith("--remote=") || /^--x-remote/.test(a));
}

/**
 * The wrangler arguments the local commands run: always `--local`. A seed
 * runs `file`; a reset deletes the local state and then migrates.
 */
export function localArgs(command: "migrate" | "seed", file = ".wrangler/seed.sql"): string[] {
  return command === "migrate"
    ? ["d1", "migrations", "apply", BINDING, "--local"]
    : ["d1", "execute", BINDING, "--local", `--file=${file}`];
}

/** A score's id, as the Worker makes them: a uuid. */
const SCORE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type OwnerAction = "flag-name" | "unflag-name" | "shadow" | "unshadow" | "find";

const sqlString = (text: string): string => `'${text.replace(/'/g, "''")}'`;

/** The one statement an owner action runs. Refuses anything that isn't a score id (or, for find, a name). */
export function ownerSql(action: OwnerAction, arg: string): string {
  if (action === "find") {
    const name = sqlString(normaliseNickname(arg));
    return (
      "SELECT id, nickname, streak, day_key, name_flagged, shadow, shadow_reason FROM scores " +
      `WHERE nickname_normalised = ${name} ORDER BY created_at DESC LIMIT 50; ` +
      "SELECT id, nickname, score, game_no, name_flagged, shadow, shadow_reason FROM daily_entries " +
      `WHERE nickname_normalised = ${name} ORDER BY started_at DESC LIMIT 50`
    );
  }
  if (!SCORE_ID.test(arg)) throw new Error(`not a score id: ${arg}`);
  const set = {
    "flag-name": "name_flagged = 1",
    "unflag-name": "name_flagged = 0",
    shadow: "shadow = 1, shadow_reason = COALESCE(shadow_reason, 'owner')",
    unshadow: "shadow = 0, shadow_reason = NULL",
  }[action];
  // An id is in one table or the other; the update finds it wherever it is.
  return (
    `UPDATE scores SET ${set} WHERE id = ${sqlString(arg)}; ` +
    `UPDATE daily_entries SET ${set} WHERE id = ${sqlString(arg)}`
  );
}

/** Where seeded players publish from, roughly as a football crowd would; null: no flag. */
const SEED_COUNTRIES: readonly (string | null)[] = [
  "GB",
  "GB",
  "GB",
  "US",
  "BR",
  "BR",
  "AR",
  "ES",
  "ES",
  "DE",
  "FR",
  "IT",
  "IT",
  "NL",
  "PT",
  "IE",
  "NG",
  "GH",
  "EG",
  "ZA",
  "IN",
  "JP",
  "KR",
  "AU",
  "CA",
  "MX",
  "SE",
  "NO",
  "PL",
  "TR",
  null,
  null,
  null,
  null,
  null,
];

/** Seeded runs' streaks stay at or under this, so the crafted top 60 always outranks them. */
const SEED_STREAK_CAP = 60;

/**
 * Fake scores around `today`: today, yesterday, earlier this week, earlier
 * this month and last month, some devices publishing several runs, a few
 * shadowed and a few names retired, each with a thinking time and, mostly, a
 * country (about one in seven without: not shown). On top of those, sixty
 * devices publish today with streaks from 120 down, so they are the top 60 of
 * today's, this week's and this month's boards, with ties placed where the
 * page has to cope: ranks 10 and 11 share a streak (either side of the first
 * page break) and so do 50 and 51 (one in the top 50, one just outside it).
 * Deterministic for a date. Replaces an earlier seed (its run ids start
 * `seed-`).
 */
export function seedSql(today: Date, count = 320): string {
  const rng = createRng(`seed:${dayKey(today)}`);
  const midnight = startOfDay(today);
  const week = periodOf(today, "week");
  const month = periodOf(today, "month");
  const daysBack = (n: number) => new Date(midnight - n * DAY_MS);
  const within = (from: number, to: number) => {
    const span = Math.max(0, Math.round((to - from) / DAY_MS));
    return new Date(from + rng.int(span + 1) * DAY_MS);
  };
  const pickDay = (): Date => {
    const r = rng.next();
    if (r < 0.4) return today;
    if (r < 0.55) return daysBack(1);
    if (r < 0.75) return within(week.startsAt, midnight);
    if (r < 0.92) return within(month.startsAt, midnight);
    return within(midnight - 45 * DAY_MS, month.startsAt - DAY_MS);
  };
  const country = (): string => {
    const c = SEED_COUNTRIES[rng.int(SEED_COUNTRIES.length)] ?? null;
    return c === null ? "NULL" : sqlString(c);
  };
  /** About 1.5–6 s of thinking a question. */
  const thinking = (streak: number) => streak * (1500 + rng.int(4500)) + rng.int(3000);
  const rows: string[] = [];
  const row = (values: {
    id: string;
    day: Date;
    nickname: string;
    streak: number;
    think: number;
    device: string;
    run: string;
    created: number;
    flagged: boolean;
    shadow: boolean;
  }): void => {
    rows.push(
      "(" +
        [
          sqlString(values.id),
          "'endless'",
          dayKey(values.day),
          sqlString(values.nickname),
          sqlString(normaliseNickname(values.nickname)),
          values.streak,
          values.think,
          country(),
          sqlString(values.device),
          sqlString(values.run),
          values.created,
          values.flagged ? 1 : 0,
          values.shadow ? 1 : 0,
          values.shadow ? "'seed'" : "NULL",
        ].join(", ") +
        ")",
    );
  };

  const devices = Math.round(count * 0.7);
  for (let i = 0; i < count; i += 1) {
    const day = pickDay();
    // Most runs short, a few long: roughly the Endless spread.
    const streak = Math.min(SEED_STREAK_CAP, 1 + Math.floor(-Math.log(1 - rng.next() * 0.999) * 9));
    row({
      id: `5eed0000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      day,
      nickname: generateNickname(() => rng.next()),
      streak,
      think: thinking(streak),
      device: `seed-device-${rng.int(devices)}`,
      run: `seed-${dayKey(day)}-${i}`,
      created: day.getTime() + rng.int(DAY_MS - 60_000),
      flagged: rng.next() < 0.03,
      shadow: rng.next() < 0.05,
    });
  }

  // Today's top 60, with ties at ranks 10–11 and 50–51.
  const top = Array.from({ length: 60 }, (_, i) => 120 - i);
  top[10] = top[9] ?? 0;
  top[50] = top[49] ?? 0;
  top.forEach((streak, i) => {
    row({
      id: `5eed0000-0000-4000-9000-${String(i).padStart(12, "0")}`,
      day: today,
      nickname: generateNickname(() => rng.next()),
      streak,
      // Within a tie, the one ranked first thought for less.
      think: 90_000 + i * 1_234,
      device: `seed-top-${i}`,
      run: `seed-${dayKey(today)}-top-${i}`,
      created: midnight + 60_000 + i * 1000,
      flagged: false,
      shadow: false,
    });
  });

  return [
    "DELETE FROM scores WHERE run_id LIKE 'seed-%';",
    "INSERT INTO scores (id, mode, day_key, nickname, nickname_normalised, streak, think_ms, " +
      "country, device_hash, run_id, created_at, name_flagged, shadow, shadow_reason) VALUES",
    rows.join(",\n") + ";",
    "",
  ].join("\n");
}

/** The seeded name taken in today's Daily game, to try "That name is taken today". */
export const SEED_TAKEN_NAME = "TakenName";

/** The seeded winner of the game before today's: "BraveFreekick35 got 23 in Game 11". */
export const SEED_WINNER = "BraveFreekick35";

/**
 * Daily Ranked entries for the game in play on `today` and the one before,
 * every one finished, so the board, its pinned row, ties, flags, a retired
 * name, shadowed runs and the winner line can all be tried locally — after
 * firing the midnight cron, the previous game's snapshot too. The game before
 * has about a hundred and forty players, its winner `SEED_WINNER` on 23
 * (20/20 and 3 bonus rounds), ties at ranks 10–11 and 50–51; today's has
 * thirty, `SEED_TAKEN_NAME` among them. Run keys start `seed-`, and a seed
 * replaces an earlier one. Nothing before Game 1.
 *
 * No frozen game is seeded: the first real start freezes today's from the
 * deck and the local secret, as in production.
 */
export function dailySeedSql(today: Date, epoch = dailyEpochMs()): string {
  const gameNo = gameNoAt(today.getTime(), epoch);
  const statements = ["DELETE FROM daily_entries WHERE run_key LIKE 'seed-%';"];
  if (!isGame(gameNo)) return statements.join("\n") + "\n";
  const rng = createRng(`seed:daily:${gameNo}`);
  const rows: string[] = [];
  const country = (): string => {
    const c = SEED_COUNTRIES[rng.int(SEED_COUNTRIES.length)] ?? null;
    return c === null ? "NULL" : sqlString(c);
  };
  const entries = (game: number, scores: readonly number[], named: Map<number, string>): void => {
    if (!isGame(game)) return;
    const used = new Set<string>([...named.values()].map((n) => normaliseNickname(n)));
    const starts = gameStartsAt(game, epoch);
    scores.forEach((score, i) => {
      let nickname = named.get(i);
      while (nickname === undefined || (!named.has(i) && used.has(normaliseNickname(nickname)))) {
        nickname = generateNickname(() => rng.next());
      }
      used.add(normaliseNickname(nickname));
      const correct = Math.min(DAILY_QUESTIONS, score);
      const bonus = score - correct;
      // Which of the twenty were right, then the bonus run and its miss.
      const marks = Array.from({ length: DAILY_QUESTIONS }, (_, q) => q < correct);
      for (let q = marks.length - 1; q > 0 && correct < DAILY_QUESTIONS; q -= 1) {
        const j = rng.int(q + 1);
        [marks[q], marks[j]] = [marks[j] ?? false, marks[q] ?? false];
      }
      const results =
        marks.map((m) => (m ? "1" : "0")).join("") +
        (correct === DAILY_QUESTIONS ? "1".repeat(bonus) + "0" : "");
      const started = starts + 60_000 + rng.int(DAY_MS - 2 * 3_600_000);
      const shadow = i > 5 && rng.next() < 0.04;
      rows.push(
        "(" +
          [
            sqlString(
              `5eed0000-0000-4000-a000-${String(game).padStart(4, "0")}${String(i).padStart(8, "0")}`,
            ),
            game,
            sqlString(`seed-${game}-${i}`),
            sqlString(`seed-daily-${game}-${i}`),
            sqlString(nickname),
            sqlString(normaliseNickname(nickname)),
            country(),
            started,
            started + 180_000 + rng.int(240_000),
            score,
            correct,
            bonus,
            // Within a tie, the one ranked first thought for less.
            40_000 + i * 731 + rng.int(500),
            sqlString(results),
            sqlString(correct === DAILY_QUESTIONS ? "wrong" : "finished"),
            i > 5 && rng.next() < 0.03 ? 1 : 0,
            shadow ? 1 : 0,
            shadow ? "'seed'" : "NULL",
          ].join(", ") +
          ")",
      );
    });
  };

  // The game before: a winner on 23, a few more perfect runs, then the spread.
  const before = [23, 22, 21, 21, 20, 19, 19, 18, 18, 17, 17];
  while (before.length < 140)
    before.push(Math.max(0, 16 - Math.floor(-Math.log(1 - rng.next() * 0.999) * 3)));
  before.sort((a, b) => b - a);
  before[50] = before[49] ?? 0;
  entries(gameNo - 1, before, new Map([[0, SEED_WINNER]]));

  const todays = Array.from({ length: 30 }, () => 6 + rng.int(15));
  todays[0] = 24;
  todays.sort((a, b) => b - a);
  entries(gameNo, todays, new Map([[3, SEED_TAKEN_NAME]]));

  statements.push(
    "INSERT INTO daily_entries (id, game_no, run_key, device_hash, nickname, nickname_normalised, " +
      "country, started_at, finished_at, score, correct, bonus, think_ms, results, end_reason, " +
      "name_flagged, shadow, shadow_reason) VALUES",
    rows.join(",\n") + ";",
  );
  return statements.join("\n") + "\n";
}

// ---------------------------------------------------------------- the commands

/**
 * Runs wrangler. A local command runs as non-interactive (`CI`), so applying
 * a local migration doesn't stop `pnpm dev` to ask; a remote one keeps
 * wrangler's own questions.
 */
function wrangler(args: readonly string[]): number {
  const local = args.includes("--local");
  // Windows needs the shell to find pnpm, and the shell splits at spaces.
  const shell = process.platform === "win32";
  const quoted = shell ? args.map((a) => (/\s/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)) : args;
  const result = spawnSync("pnpm", ["exec", "wrangler", ...quoted], {
    cwd: root,
    stdio: "inherit",
    shell,
    env: local ? { ...process.env, CI: "true" } : process.env,
  });
  return result.status ?? 1;
}

/** Local commands never touch the real database, whatever they're given. */
function refuseRemote(args: readonly string[]): void {
  if (asksRemote(args)) {
    console.error("This command only works on the local database. It never takes --remote.");
    process.exit(1);
  }
}

async function confirm(question: string, expected: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim() === expected;
  } finally {
    rl.close();
  }
}

function migrateLocal(): number {
  return wrangler(localArgs("migrate"));
}

async function migrateRemote(): Promise<number> {
  const config = databaseConfig(readFileSync(join(root, "wrangler.toml"), "utf8"));
  if (config === undefined) {
    console.error("wrangler.toml has no [[d1_databases]] block.");
    return 1;
  }
  if (config.id === PLACEHOLDER_ID) {
    console.error(
      "wrangler.toml still has the placeholder database_id. Create the database first:\n" +
        `  pnpm exec wrangler d1 create ${config.name}\n` +
        "then put the id it prints into wrangler.toml.",
    );
    return 1;
  }
  console.log(`\nThis applies migrations/ to the PRODUCTION database:`);
  console.log(`  name ${config.name}\n  id   ${config.id}\n`);
  console.log("Pending migrations, as the remote database reports them:\n");
  const listed = wrangler(["d1", "migrations", "list", BINDING, "--remote"]);
  if (listed !== 0) return listed;
  if (!(await confirm(`\nType the database name (${config.name}) to apply them: `, config.name))) {
    console.log("Nothing applied.");
    return 1;
  }
  return wrangler(["d1", "migrations", "apply", BINDING, "--remote"]);
}

function seedLocal(args: readonly string[]): number {
  refuseRemote(args);
  const at = args.indexOf("--date");
  const date = at === -1 ? new Date() : new Date(`${args[at + 1] ?? ""}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    console.error("--date takes YYYY-MM-DD");
    return 1;
  }
  const dir = join(root, ".wrangler");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "seed.sql");
  writeFileSync(file, seedSql(date) + dailySeedSql(date));
  const code = wrangler(localArgs("seed", relative(root, file)));
  if (code === 0) {
    console.log(`\nSeeded the local database around ${date.toISOString().slice(0, 10)}.`);
    const game = gameNoAt(date.getTime(), dailyEpochMs());
    if (isGame(game)) {
      console.log(
        `Daily Ranked: Game ${game} and Game ${game - 1}; "${SEED_TAKEN_NAME}" is taken in Game ${game}.`,
      );
    }
  }
  return code;
}

function resetLocal(args: readonly string[]): number {
  refuseRemote(args);
  const dir = resolve(root, ".wrangler", "state", "v3", "d1");
  if (!dir.startsWith(join(root, ".wrangler"))) {
    console.error(`refusing to delete ${dir}: not under this repo's .wrangler`);
    return 1;
  }
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  console.log(`Deleted ${relative(root, dir)}.`);
  return migrateLocal();
}

async function owner(args: readonly string[]): Promise<number> {
  const local = args.includes("--local");
  const [action, ...rest] = args.filter((a) => a !== "--local");
  const actions: readonly OwnerAction[] = [
    "flag-name",
    "unflag-name",
    "shadow",
    "unshadow",
    "find",
  ];
  if (
    action === undefined ||
    !(actions as readonly string[]).includes(action) ||
    rest.length === 0
  ) {
    console.error(`usage: pnpm db:owner <${actions.join(" | ")}> <score id | nickname> [--local]`);
    return 1;
  }
  const sql = ownerSql(action as OwnerAction, rest.join(" "));
  const where = local ? "--local" : "--remote";
  const command = ["d1", "execute", BINDING, where, "--command", sql];
  console.log(`\n  wrangler ${command.slice(0, 4).join(" ")} --command "${sql}"\n`);
  if (!local && action !== "find") {
    if (!(await confirm("Run this against the PRODUCTION database? Type yes: ", "yes"))) {
      console.log("Nothing changed.");
      return 1;
    }
  }
  const code = wrangler(command);
  if (code === 0 && action !== "find") {
    console.log("Done. Boards are cached for up to a minute, so give it that long to show.");
  }
  return code;
}

async function main(argv: readonly string[]): Promise<number> {
  const [command, ...args] = argv;
  switch (command) {
    case "migrate:local":
      refuseRemote(args);
      return migrateLocal();
    case "migrate:remote":
      return migrateRemote();
    case "seed:local":
      return seedLocal(args);
    case "reset:local":
      return resetLocal(args);
    case "owner":
      return owner(args);
    default:
      console.error(
        "usage: tsx scripts/db.ts <migrate:local | migrate:remote | seed:local | reset:local | owner>",
      );
      return 1;
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(await main(process.argv.slice(2)));
}
