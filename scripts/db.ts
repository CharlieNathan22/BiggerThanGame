/**
 * The boards' D1 database, from the command line (ARCHITECTURE.md §10).
 *
 * Everything local runs against wrangler's **local** D1 (Miniflare's state
 * under .wrangler/), never the real database:
 *
 *   pnpm db:migrate:local           apply migrations/ locally (pnpm dev does it first)
 *   pnpm db:seed:local [--date D]   a few hundred fake scores around day D (default today)
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
 * `db:owner` takes `--local` to try it on the local database instead.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import {
  DAY_MS,
  createRng,
  dayKey,
  generateNickname,
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

/** A score's id, as the Worker makes them: a uuid. */
const SCORE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type OwnerAction = "flag-name" | "unflag-name" | "shadow" | "unshadow" | "find";

const sqlString = (text: string): string => `'${text.replace(/'/g, "''")}'`;

/** The one statement an owner action runs. Refuses anything that isn't a score id (or, for find, a name). */
export function ownerSql(action: OwnerAction, arg: string): string {
  if (action === "find") {
    return (
      "SELECT id, nickname, streak, day_key, name_flagged, shadow, shadow_reason FROM scores " +
      `WHERE nickname_normalised = ${sqlString(normaliseNickname(arg))} ORDER BY created_at DESC LIMIT 50`
    );
  }
  if (!SCORE_ID.test(arg)) throw new Error(`not a score id: ${arg}`);
  const set = {
    "flag-name": "name_flagged = 1",
    "unflag-name": "name_flagged = 0",
    shadow: "shadow = 1, shadow_reason = COALESCE(shadow_reason, 'owner')",
    unshadow: "shadow = 0, shadow_reason = NULL",
  }[action];
  return `UPDATE scores SET ${set} WHERE id = ${sqlString(arg)}`;
}

/**
 * Fake scores around `today`: today, yesterday, earlier this week, earlier
 * this month and last month, some devices publishing several runs, a few
 * shadowed and a few names retired. Deterministic for a date. Replaces an
 * earlier seed (its run ids start `seed-`).
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
  const rows: string[] = [];
  const devices = Math.round(count * 0.7);
  for (let i = 0; i < count; i += 1) {
    const day = pickDay();
    const nickname = generateNickname(() => rng.next());
    // Most runs short, a few long: roughly the Endless spread.
    const streak = 1 + Math.floor(-Math.log(1 - rng.next() * 0.999) * 9);
    const elapsed = streak * (5000 + rng.int(6000)) + rng.int(4000);
    const shadow = rng.next() < 0.05;
    const flagged = rng.next() < 0.03;
    const id = `5eed0000-0000-4000-8000-${String(i).padStart(12, "0")}`;
    const created = day.getTime() + rng.int(DAY_MS - 60_000);
    rows.push(
      "(" +
        [
          sqlString(id),
          "'endless'",
          dayKey(day),
          sqlString(nickname),
          sqlString(normaliseNickname(nickname)),
          streak,
          elapsed,
          sqlString(`seed-device-${rng.int(devices)}`),
          sqlString(`seed-${dayKey(day)}-${i}`),
          created,
          flagged ? 1 : 0,
          shadow ? 1 : 0,
          shadow ? "'seed'" : "NULL",
        ].join(", ") +
        ")",
    );
  }
  return [
    "DELETE FROM scores WHERE run_id LIKE 'seed-%';",
    "INSERT INTO scores (id, mode, day_key, nickname, nickname_normalised, streak, elapsed_ms, " +
      "device_hash, run_id, created_at, name_flagged, shadow, shadow_reason) VALUES",
    rows.join(",\n") + ";",
    "",
  ].join("\n");
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
  if (args.some((a) => a === "--remote" || a.startsWith("--remote="))) {
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
  return wrangler(["d1", "migrations", "apply", BINDING, "--local"]);
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
  writeFileSync(file, seedSql(date));
  const code = wrangler(["d1", "execute", BINDING, "--local", `--file=${relative(root, file)}`]);
  if (code === 0) {
    console.log(`\nSeeded the local database around ${date.toISOString().slice(0, 10)}.`);
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
